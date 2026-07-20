import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const siteUrl = "https://moboko-production.up.railway.app";
const planKey = `audio_smoke_${Date.now()}`;

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
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`${pathname}=${res.status} ok=${Boolean(body.ok)} error=${body.error ?? ""}`);
  return { res, body };
}

const { data: audio } = await admin
  .from("audio_items")
  .select("id, title")
  .eq("category", "sermon")
  .eq("is_active", true)
  .eq("full_download_enabled", true)
  .limit(1)
  .single();
if (!audio) throw new Error("Aucun sermon actif avec telechargement complet");

const email = `audio-sub-${Date.now()}@moboko.local`;
const password = `MobokoSub!${Date.now()}`;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw created.error;
const userId = created.data.user.id;

try {
  const plan = await admin.from("billing_subscription_plans").insert({
    plan_key: planKey,
    name: "Audio smoke",
    description: "Plan temporaire smoke test",
    user_visible_text: "Plan temporaire smoke test",
    price: 0,
    currency: "USD",
    duration_days: 1,
    is_active: false,
    is_featured: false,
    display_order: 9999,
    audio_streaming: true,
    audio_offline_in_app: true,
    audio_full_download: true,
    audio_search: true,
  });
  if (plan.error) throw plan.error;

  const subscription = await admin.from("subscriptions").insert({
    user_id: userId,
    plan_key: planKey,
    status: "active",
    provider: "smoke",
    current_period_end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  if (subscription.error) throw subscription.error;

  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const token = signed.data.session.access_token;

  await postJson(`/api/audio/${audio.id}/stream`, token);
  await postJson(`/api/audio/${audio.id}/offline`, token);
  await postJson(`/api/audio/${audio.id}/download`, token);
  console.log(`subscription_plan_key=${planKey}`);
  console.log(`subscription_audio=${audio.title}`);
} finally {
  await admin.from("audio_offline_records").delete().eq("user_id", userId);
  await admin.from("subscriptions").delete().eq("user_id", userId);
  await admin.from("billing_subscription_plans").delete().eq("plan_key", planKey);
  await admin.auth.admin.deleteUser(userId);
}
