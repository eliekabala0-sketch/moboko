import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = path.resolve("apps/web/.env.local");
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://moboko-production.up.railway.app";

function readEnv(file) {
  const out = {};
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/g)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return out;
}

function hymnVerseText(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.text === "string") return value.text.trim();
  return "";
}

function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function projectionUnits(hymn) {
  const verses = Array.isArray(hymn.verses) ? hymn.verses.map(hymnVerseText).filter(Boolean) : [];
  const chorus = typeof hymn.chorus === "string" && hymn.chorus.trim() ? hymn.chorus.trim() : null;
  if (hymn.validation_status === "needs_review" || verses.length === 0) {
    return [{ label: "Texte complet", text: hymn.lyrics ?? "" }];
  }
  return verses.flatMap((verse, index) => {
    const out = [{ label: `Couplet ${index + 1}`, text: verse }];
    if (chorus) out.push({ label: "Refrain", text: chorus });
    return out;
  });
}

async function countRows(supabase, table, query = (q) => q) {
  const { count, error } = await query(supabase.from(table).select("id", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}

async function fetchStatus(url) {
  const started = Date.now();
  const response = await fetch(url, { redirect: "manual" });
  return { status: response.status, ms: Date.now() - started };
}

async function main() {
  const env = readEnv(ENV_FILE);
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const schemaChecks = {};
  const { data: schemaProbe, error: schemaError } = await supabase
    .from("hymns")
    .select("id, validation_status, validation_notes, confidence_score, source_mapping, structure_anomalies, structure_proposal, structure_checked_at")
    .limit(1);
  schemaChecks.hymn_validation_columns = !schemaError && Array.isArray(schemaProbe);
  schemaChecks.hymn_validation_error = schemaError?.message ?? null;

  const { data: historyProbe, error: historyError } = await supabase
    .from("hymn_structure_history")
    .select("id, hymn_id, previous_verses, previous_chorus, changed_at, changed_by, source, snapshot")
    .limit(1);
  schemaChecks.history_table = !historyError && Array.isArray(historyProbe);
  schemaChecks.history_error = historyError?.message ?? null;

  const { data: guardRow, error: guardReadError } = await supabase
    .from("hymns")
    .select("id, title")
    .limit(1)
    .single();
  if (guardReadError) throw guardReadError;
  const { error: anonUpdateError } = await anon
    .from("hymns")
    .update({ title: "__anon_write_probe__" })
    .eq("id", guardRow.id);
  const { data: guardAfter, error: guardAfterError } = await supabase
    .from("hymns")
    .select("title")
    .eq("id", guardRow.id)
    .single();
  if (guardAfterError) throw guardAfterError;
  schemaChecks.anon_update_blocked = guardAfter.title === guardRow.title;
  schemaChecks.anon_update_error = anonUpdateError?.message ?? null;

  const totalHymns = await countRows(supabase, "hymns");
  const high = await countRows(supabase, "hymns", (q) => q.eq("confidence_score", "high"));
  const needsReview = await countRows(supabase, "hymns", (q) => q.eq("validation_status", "needs_review"));
  const history = await countRows(supabase, "hymn_structure_history");
  const duplicateProbe = await supabase
    .from("hymns")
    .select("id, number, book_id")
    .limit(1000);
  if (duplicateProbe.error) throw duplicateProbe.error;
  const duplicateKeys = new Set();
  const duplicates = [];
  for (const row of duplicateProbe.data ?? []) {
    const key = `${row.book_id}:${row.number}`;
    if (duplicateKeys.has(key)) duplicates.push(key);
    duplicateKeys.add(key);
  }

  const tests = [
    ["pene-na-yo", "1"],
    ["pene-na-yo", "2"],
    ["pene-na-yo", "56"],
    ["crois-seulement", "1"],
    ["crois-seulement", "3"],
    ["crois-seulement", "40"],
    ["crois-seulement", "41"],
    ["hosanna", "1"],
    ["hosanna", "136"],
    ["hosanna", "246"],
  ];
  const hymnTests = [];
  for (const [bookSlug, number] of tests) {
    const { data: book, error: bookError } = await supabase
      .from("hymn_books")
      .select("id, slug, name")
      .eq("slug", bookSlug)
      .single();
    if (bookError) throw bookError;
    const { data: hymn, error: hymnError } = await supabase
      .from("hymns")
      .select("id, slug, title, number, lyrics, full_text, verses, chorus, validation_status, confidence_score")
      .eq("book_id", book.id)
      .eq("number", number)
      .maybeSingle();
    if (hymnError) throw hymnError;
    const units = hymn ? projectionUnits(hymn) : [];
    const hasChorus = Boolean(hymn?.chorus);
    const endsOnChorus = units.at(-1)?.label === "Refrain";
    const route = hymn ? `${SITE_URL}/hymns/${book.slug}/${encodeURIComponent(hymn.number)}` : null;
    const routeStatus = route ? await fetchStatus(route) : null;
    hymnTests.push({
      book: bookSlug,
      number,
      found: Boolean(hymn),
      title: hymn?.title ?? null,
      validation_status: hymn?.validation_status ?? null,
      confidence_score: hymn?.confidence_score ?? null,
      verses: Array.isArray(hymn?.verses) ? hymn.verses.length : 0,
      has_chorus: hasChorus,
      projection_units: units.map((unit) => unit.label),
      ends_on_chorus: hasChorus ? endsOnChorus : null,
      full_text_preserved: hymn ? normalize(hymn.full_text ?? hymn.lyrics).length > 0 : false,
      public_route: routeStatus,
    });
  }

  const reviewRoute = await fetchStatus(`${SITE_URL}/admin/hymns/review`);
  const report = {
    checked_at: new Date().toISOString(),
    site_url: SITE_URL,
    schema: schemaChecks,
    counts: {
      hymns: totalHymns,
      high,
      needs_review: needsReview,
      history_rows: history,
      duplicate_logical_keys: duplicates.length,
    },
    hymn_tests: hymnTests,
    routes: {
      admin_review: reviewRoute,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
