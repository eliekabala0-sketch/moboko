import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = path.resolve("apps/web/.env.local");
const LOCAL_FILE = path.resolve("data/import-ready/bible-biblio-1910.json");

function readEnv(file) {
  const result = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function key(row) {
  return `${row.book_name ?? row.book}.${row.chapter}.${row.verse}`;
}

function corrupt(text) {
  return !text || text.length < 2 || text.length > 2000 || /ö{8,}|�|&(?:[a-z]+|#\d+);/iu.test(text);
}

async function main() {
  const env = readEnv(ENV_FILE);
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const local = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
  const { count: wordsOfJesusCount, error: wordsOfJesusError } = await supabase
    .from("bible_passages")
    .select("id", { count: "exact", head: true })
    .eq("translation", local.version.abbreviation)
    .eq("has_words_of_jesus", true);
  const remote = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("bible_passages")
      .select("book_name,book,chapter,verse,text,validation_status,has_words_of_jesus")
      .eq("translation", local.version.abbreviation)
      .order("book_number", { ascending: true })
      .order("chapter", { ascending: true })
      .order("verse", { ascending: true })
      .range(start, start + 999);
    if (error) throw error;
    remote.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const localByRef = new Map(local.passages.map((row) => [key(row), row]));
  const remoteByRef = new Map(remote.map((row) => [key(row), row]));
  const missing = [...localByRef.keys()].filter((ref) => !remoteByRef.has(ref));
  const extra = [...remoteByRef.keys()].filter((ref) => !localByRef.has(ref));
  const different = [...localByRef].filter(([ref, row]) => remoteByRef.has(ref) && remoteByRef.get(ref).text !== row.text);
  const differentWordsOfJesus = [...localByRef].filter(
    ([ref, row]) => remoteByRef.has(ref) && Boolean(remoteByRef.get(ref).has_words_of_jesus) !== Boolean(row.has_words_of_jesus),
  );
  const sampleRefs = ["Matthieu.3.15", "Matthieu.3.16", "Jean.3.16", "Jean.3.17"];
  const wordsOfJesusSamples = sampleRefs.map((ref) => ({
    ref: ref.replaceAll(".", " "),
    local: Boolean(localByRef.get(ref)?.has_words_of_jesus),
    production: Boolean(remoteByRef.get(ref)?.has_words_of_jesus),
    matches: Boolean(localByRef.get(ref)?.has_words_of_jesus) === Boolean(remoteByRef.get(ref)?.has_words_of_jesus),
  }));
  const report = {
    checked_at: new Date().toISOString(),
    translation: local.version.abbreviation,
    local_verses: local.passages.length,
    production_rows: remote.length,
    production_unique_refs: remoteByRef.size,
    missing_from_production: missing.length,
    extra_in_production: extra.length,
    different_texts: different.length,
    corrupt_production_texts: remote.filter((row) => corrupt(row.text)).map(key),
    words_of_jesus_column: !wordsOfJesusError,
    words_of_jesus_verses: wordsOfJesusError ? null : (wordsOfJesusCount ?? 0),
    different_words_of_jesus: differentWordsOfJesus.length,
    words_of_jesus_samples: wordsOfJesusSamples,
    words_of_jesus_schema_error: wordsOfJesusError?.message ?? null,
    complete: missing.length === 0 && different.length === 0 && differentWordsOfJesus.length === 0 && remoteByRef.size >= localByRef.size,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.complete || report.corrupt_production_texts.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
