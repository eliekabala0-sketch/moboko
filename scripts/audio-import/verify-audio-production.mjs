import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const siteUrl = "https://moboko-production.up.railway.app";

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), "apps", "web", ".env.local"));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} manquant`);
  return value;
}

const admin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function tableCount(table) {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true });
  console.log(`${table}=${error ? `ERROR ${error.code} ${error.message}` : `OK ${count}`}`);
}

for (const table of [
  "audio_items",
  "audio_import_runs",
  "audio_import_events",
  "audio_progress",
  "audio_offline_records",
  "user_audio_access_overrides",
  "audio_transcripts",
  "audio_transcript_segments",
]) {
  await tableCount(table);
}

const { data: bucket, error: bucketError } = await admin.storage.getBucket("sermon-audio");
console.log(
  `bucket.sermon-audio=${
    bucketError ? `ERROR ${bucketError.message}` : `OK public=${bucket.public}`
  }`,
);

const { data: plans, error: planError } = await admin
  .from("billing_subscription_plans")
  .select("id, name, audio_streaming, audio_offline_in_app, audio_full_download, audio_search")
  .limit(5);
console.log(
  `billing_audio_columns=${
    planError ? `ERROR ${planError.code} ${planError.message}` : `OK sample=${plans?.length ?? 0}`
  }`,
);

const { data: activeAudio, error: activeError } = await admin
  .from("audio_items")
  .select("id, category, title, sermon_id, sermon_match_status, storage_path, is_active, streaming_enabled, offline_enabled, full_download_enabled")
  .eq("is_active", true)
  .order("imported_at", { ascending: false })
  .limit(10);
console.log(
  `active_audio=${
    activeError ? `ERROR ${activeError.code} ${activeError.message}` : `OK count=${activeAudio?.length ?? 0}`
  }`,
);
for (const item of activeAudio ?? []) {
  console.log(
    `active_item=${item.category}|${item.title}|match=${item.sermon_match_status}|sermon=${Boolean(item.sermon_id)}|stream=${item.streaming_enabled}|offline=${item.offline_enabled}|download=${item.full_download_enabled}`,
  );
}

const { data: linkedAudio, count: linkedAudioCount, error: linkedAudioError } = await admin
  .from("audio_items")
  .select("id, title, sermon_id, sermons!inner(slug, title)", { count: "exact" })
  .eq("category", "sermon")
  .eq("is_active", true)
  .eq("streaming_enabled", true)
  .not("sermon_id", "is", null)
  .limit(5);
console.log(`linked_streamable_sermon_audio=${linkedAudioError ? `ERROR ${linkedAudioError.message}` : linkedAudioCount ?? 0}`);
for (const item of linkedAudio ?? []) {
  const sermon = Array.isArray(item.sermons) ? item.sermons[0] : item.sermons;
  console.log(`linked_audio_sample=${item.title}|slug=${sermon?.slug ?? ""}|sermon=${sermon?.title ?? ""}`);
}

const { count: prayerSermonLinks, error: prayerLinkError } = await admin
  .from("audio_items")
  .select("id", { count: "exact", head: true })
  .eq("category", "prayer_line")
  .not("sermon_id", "is", null);
console.log(`prayer_lines_linked_to_sermons=${prayerLinkError ? `ERROR ${prayerLinkError.message}` : prayerSermonLinks ?? 0}`);

const { data: statusRows, error: statusError } = await admin
  .from("audio_items")
  .select("category, import_status, is_active, storage_path");
if (statusError) {
  console.log(`audio_status=ERROR ${statusError.code} ${statusError.message}`);
} else {
  const totals = new Map();
  const chunked = new Map();
  for (const row of statusRows ?? []) {
    const key = `${row.category}|${row.import_status}|active=${row.is_active}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
    if (String(row.storage_path ?? "").endsWith(".manifest.json")) {
      chunked.set(row.category, (chunked.get(row.category) ?? 0) + 1);
    }
  }
  for (const [key, value] of totals) console.log(`audio_status ${key}=${value}`);
  for (const [key, value] of chunked) console.log(`audio_chunked ${key}=${value}`);
}

for (const url of ["/audio", "/admin/audio", "/api/audio?category=sermon&limit=3", "/api/audio?category=prayer_line&limit=3"]) {
  const res = await fetch(`${siteUrl}${url}`);
  const text = await res.text();
  console.log(`http ${url}=${res.status} length=${text.length}`);
}
