import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const index = text.indexOf("=");
    const key = text.slice(0, index).trim();
    if (!process.env[key]) process.env[key] = text.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseCode(value) {
  const match = String(value ?? "").match(/FRN(?<yy>\d{2})-(?<md>\d{4})(?<session>[A-Z]?)/i);
  if (!match?.groups) return { code: null, date: null, session: null };
  const yearPart = Number(match.groups.yy);
  const year = yearPart < 30 ? 2000 + yearPart : 1900 + yearPart;
  const month = match.groups.md.slice(0, 2);
  const day = match.groups.md.slice(2, 4);
  return {
    code: match[0].toUpperCase(),
    date: `${year}-${month}-${day}`,
    session: match.groups.session?.toUpperCase() || null,
  };
}

function sermonSession(sermon) {
  const match = `${sermon.title ?? ""} ${sermon.source_file ?? ""}`.match(/\b(?:\d{2}[.\/-]\d{2}[.\/-]\d{2}|\d{4})\s*([MES])\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function titleScore(audioTitle, sermonTitle) {
  const a = normalize(audioTitle).split(" ").filter((word) => word.length >= 4);
  const b = normalize(sermonTitle);
  if (a.length === 0) return 0;
  return a.filter((word) => b.includes(word)).length / a.length;
}

loadEnv(path.resolve("apps/web/.env.local"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

const { data: audio, error: audioError } = await admin
  .from("audio_items")
  .select("id,title,title_original,original_filename,sermon_id,sermon_match_status,sermon_date")
  .eq("category", "sermon")
  .limit(1000);
if (audioError) throw audioError;
const sermons = [];
for (let start = 0; ; start += 1000) {
  const { data, error: sermonError } = await admin
    .from("sermons")
    .select("id,title,preached_on,source_file,is_published")
    .range(start, start + 999);
  if (sermonError) throw sermonError;
  sermons.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const byDate = new Map();
const sermonById = new Map();
for (const sermon of sermons) {
  sermonById.set(sermon.id, sermon);
  if (!sermon.is_published) continue;
  if (!sermon.preached_on) continue;
  const rows = byDate.get(sermon.preached_on) ?? [];
  rows.push(sermon);
  byDate.set(sermon.preached_on, rows);
}

const TITLE_ALIASES = [
  ["marriage and divorce", "mariage et le divorce"],
  ["who is this melchisedec", "qui est ce melchise"],
  ["future home", "demeure future"],
];

const decisions = [];
for (const item of audio ?? []) {
  const parsed = parseCode(item.original_filename);
  const date = parsed.date ?? item.sermon_date;
  const candidates = date ? byDate.get(date) ?? [] : [];
  let selected = null;
  let status = "unmatched";
  const normalizedAudioTitle = normalize(item.title_original ?? item.title);
  const officialAlias = TITLE_ALIASES.find(([english]) => normalizedAudioTitle.includes(english));
  if (officialAlias) {
    const aliasCandidates = sermons.filter((sermon) => sermon.is_published && normalize(sermon.title).includes(officialAlias[1]));
    const datedAliases = date ? aliasCandidates.filter((sermon) => sermon.preached_on === date) : aliasCandidates;
    const sessionAliases = parsed.session ? datedAliases.filter((sermon) => sermonSession(sermon) === parsed.session) : datedAliases;
    const safeAliases = sessionAliases.length === 1 ? sessionAliases : datedAliases.length === 1 ? datedAliases : aliasCandidates.length === 1 ? aliasCandidates : [];
    if (safeAliases.length === 1) {
      selected = safeAliases[0];
      status = "matched";
    }
  }
  if (!selected && !officialAlias && item.sermon_id) {
    const existing = sermonById.get(item.sermon_id) ?? { id: item.sermon_id, title: null, preached_on: null, source_file: null };
    const existingSession = sermonSession(existing);
    const officialTitleContradiction = officialAlias && !normalize(existing.title).includes(officialAlias[1]);
    if (officialTitleContradiction || (parsed.session && existingSession && parsed.session !== existingSession)) {
      selected = null;
      status = "manual_review";
    } else {
      selected = existing;
      status = item.sermon_match_status;
    }
  } else if (!officialAlias && candidates.length === 1) {
    const candidateSession = sermonSession(candidates[0]);
    if (!parsed.session || !candidateSession || parsed.session === candidateSession) {
      selected = candidates[0];
      status = "matched";
    } else {
      status = "manual_review";
    }
  } else if (!officialAlias && candidates.length > 1 && parsed.session) {
    const sessionCandidates = candidates.filter((sermon) => sermonSession(sermon) === parsed.session);
    if (sessionCandidates.length === 1) {
      selected = sessionCandidates[0];
      status = "matched";
    }
  }
  if (!selected && !officialAlias && candidates.length > 0) {
    const ranked = candidates.map((sermon) => ({ sermon, score: titleScore(item.title_original ?? item.title, sermon.title) })).sort((a, b) => b.score - a.score);
    if (ranked[0]?.score >= 0.6 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.2) {
      selected = ranked[0].sermon;
      status = "probable_match";
    } else if (candidates.length > 1) {
      status = "manual_review";
    }
  }
  if (!selected && officialAlias) {
    status = candidates.length > 0 ? "manual_review" : "unmatched";
  }
  decisions.push({ item, selected, status, parsed });
}

if (apply) {
  for (const decision of decisions) {
    const titleOriginal = decision.item.title_original || decision.item.title;
    const normalizedTitle = normalize([decision.parsed.code, titleOriginal, decision.selected?.title].filter(Boolean).join(" "));
    const { error } = await admin.from("audio_items").update({
      title_original: titleOriginal,
      sermon_code: decision.parsed.code,
      sermon_id: decision.selected?.id ?? null,
      sermon_match_status: decision.selected ? decision.status : decision.status,
      sermon_match_score: decision.status === "matched" ? 1 : decision.status === "probable_match" ? 0.7 : null,
      normalized_title: normalizedTitle,
    }).eq("id", decision.item.id);
    if (error) throw error;
  }
}

const counts = decisions.reduce((acc, decision) => {
  acc[decision.status] = (acc[decision.status] ?? 0) + 1;
  return acc;
}, {});
const changedLinks = decisions.filter((decision) => (decision.selected?.id ?? null) !== (decision.item.sermon_id ?? null)).length;
const addedLinks = decisions.filter((decision) => !decision.item.sermon_id && decision.selected?.id).length;
const removedLinks = decisions.filter((decision) => decision.item.sermon_id && !decision.selected?.id).length;
const changedExistingLinks = decisions.filter((decision) => decision.item.sermon_id && decision.selected?.id && decision.item.sermon_id !== decision.selected.id).length;
const changes = decisions
  .filter((decision) => (decision.selected?.id ?? null) !== (decision.item.sermon_id ?? null))
  .map((decision) => ({
    audio_id: decision.item.id,
    audio_title: decision.item.title_original ?? decision.item.title,
    previous_sermon_id: decision.item.sermon_id ?? null,
    selected_sermon_id: decision.selected?.id ?? null,
    selected_sermon_title: decision.selected?.title ?? null,
    status: decision.status,
  }));
const requestedSamples = ["marriage", "future home", "melchisedec", "adoption 2", "adoption 3", "adoption 4", "perseverant"];
const samples = requestedSamples.map((needle) => {
  const matching = decisions.filter((entry) => normalize(entry.item.title_original ?? entry.item.title).includes(needle));
  const decision = matching.find((entry) => entry.status === "matched") ?? matching.find((entry) => entry.status === "probable_match") ?? matching[0];
  return {
    query: needle,
    audio_title: decision?.item.title_original ?? decision?.item.title ?? null,
    sermon_title_fr: decision?.selected?.title ?? null,
    status: decision?.status ?? "not_found",
    variants: matching.map((entry) => ({ code: entry.parsed.code, sermon_title_fr: entry.selected?.title ?? null, status: entry.status })),
  };
});
console.log(JSON.stringify({
  apply,
  total: decisions.length,
  changed_links: changedLinks,
  added_links: addedLinks,
  removed_links: removedLinks,
  changed_existing_links: changedExistingLinks,
  changes,
  matched: counts.matched ?? 0,
  probable_match: counts.probable_match ?? 0,
  unmatched: counts.unmatched ?? 0,
  manual_review: counts.manual_review ?? 0,
  samples,
}, null, 2));
