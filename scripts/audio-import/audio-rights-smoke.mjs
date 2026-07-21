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

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function postJson(pathname, token) {
  const res = await fetch(`${siteUrl}${pathname}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  console.log(`${pathname}=${res.status} ok=${Boolean(body.ok)} error=${body.error ?? ""}`);
  return { status: res.status, body };
}

const { data: sermon } = await admin
  .from("audio_items")
  .select("id, title, storage_bucket, storage_path")
  .eq("category", "sermon")
  .eq("is_active", true)
  .eq("streaming_enabled", true)
  .eq("offline_enabled", true)
  .eq("full_download_enabled", true)
  .like("storage_path", "%.manifest.json")
  .limit(1)
  .single();
if (!sermon) throw new Error("Aucun sermon pilote actif");

const { data: prayer } = await admin
  .from("audio_items")
  .select("id, title, storage_bucket, storage_path, full_download_enabled")
  .eq("category", "prayer_line")
  .eq("is_active", true)
  .eq("streaming_enabled", true)
  .limit(1)
  .single();
if (!prayer) throw new Error("Aucune ligne de priere pilote active");

const publicUrl = `${url}/storage/v1/object/public/${sermon.storage_bucket}/${sermon.storage_path}`;
const publicRes = await fetch(publicUrl, { method: "GET" });
console.log(`storage_public_get=${publicRes.status}`);

await postJson(`/api/audio/${sermon.id}/stream`);

const email = `audio-smoke-${Date.now()}@moboko.local`;
const password = `MobokoAudio!${Date.now()}`;
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: "Audio Smoke" },
});
if (created.error) throw created.error;
const userId = created.data.user.id;

try {
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const token = signed.data.session.access_token;

  await postJson(`/api/audio/${sermon.id}/stream`, token);

  await admin.from("user_audio_access_overrides").upsert(
    {
      user_id: userId,
      audio_streaming: true,
      audio_offline_in_app: true,
      audio_full_download: true,
      audio_search: true,
      notes: "audio smoke test",
    },
    { onConflict: "user_id" },
  );

  const stream = await postJson(`/api/audio/${sermon.id}/stream`, token);
  if (stream.body.url) {
    const streamUrl = stream.body.url.startsWith("http") ? stream.body.url : `${siteUrl}${stream.body.url}`;
    const range = await fetch(streamUrl, { headers: { Range: "bytes=0-1023" } });
    console.log(`signed_stream_range=${range.status} bytes=${range.headers.get("content-length") ?? ""}`);
  }

  await postJson(`/api/audio/${sermon.id}/offline`, token);
  await postJson(`/api/audio/${sermon.id}/download`, token);
  await postJson(`/api/audio/${prayer.id}/stream`, token);
  await postJson(`/api/audio/${prayer.id}/download`, token);

  const { count: records } = await admin
    .from("audio_offline_records")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  console.log(`offline_records=${records ?? 0}`);
} finally {
  await admin.from("user_audio_access_overrides").delete().eq("user_id", userId);
  await admin.from("audio_offline_records").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
}

console.log(`sermon_tested=${sermon.title}`);
console.log(`prayer_line_tested=${prayer.title}`);
