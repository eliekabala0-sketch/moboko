import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: item, error: itemError } = await admin
  .from("audio_items")
  .select("id, title, updated_at")
  .eq("is_active", true)
  .limit(1)
  .single();
if (itemError) throw itemError;

const directAnon = await anon.from("audio_items").select("id").limit(1);
console.log(
  `anon_audio_items=${directAnon.error ? `ERROR ${directAnon.error.code}` : `OK rows=${directAnon.data?.length ?? 0}`}`,
);

const before = item.updated_at;
await new Promise((resolve) => setTimeout(resolve, 1100));
const update = await admin.from("audio_items").update({ title: item.title }).eq("id", item.id);
if (update.error) throw update.error;
const { data: after } = await admin.from("audio_items").select("updated_at").eq("id", item.id).single();
console.log(`trigger_updated_at=${before !== after.updated_at}`);

const email = `audio-rls-${Date.now()}@moboko.local`;
const password = `MobokoRls!${Date.now()}`;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw created.error;
const userId = created.data.user.id;
try {
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signed.data.session.access_token}` } },
  });
  const upsert = await userClient.from("audio_progress").upsert(
    { user_id: userId, audio_id: item.id, position_seconds: 12 },
    { onConflict: "user_id,audio_id" },
  );
  console.log(`owner_progress_upsert=${upsert.error ? `ERROR ${upsert.error.code}` : "OK"}`);
  const readOwn = await userClient.from("audio_progress").select("position_seconds").eq("audio_id", item.id);
  console.log(`owner_progress_read=${readOwn.error ? `ERROR ${readOwn.error.code}` : `OK rows=${readOwn.data?.length ?? 0}`}`);
  const badInsert = await userClient.from("audio_progress").upsert(
    { user_id: "00000000-0000-0000-0000-000000000000", audio_id: item.id, position_seconds: 1 },
    { onConflict: "user_id,audio_id" },
  );
  console.log(`other_progress_write=${badInsert.error ? `ERROR ${badInsert.error.code}` : "UNEXPECTED_OK"}`);
} finally {
  await admin.from("audio_progress").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
}
