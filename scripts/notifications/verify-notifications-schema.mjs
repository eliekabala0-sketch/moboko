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

const admin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function check(label, query) {
  const { error } = await query;
  console.log(`${label}=${error ? `ERROR ${error.code} ${error.message}` : "OK"}`);
}

await check(
  "posts.notification_columns",
  admin
    .from("posts")
    .select("id, post_type, priority, scheduled_at, notify_on_publish, notification_title, notification_body, notification_sent_at")
    .limit(1),
);
await check(
  "prayer_requests.admin_columns",
  admin.from("prayer_requests").select("id, created_by_admin, anonymous").limit(1),
);
await check(
  "testimonies.admin_columns",
  admin.from("testimonies").select("id, created_by_admin, anonymous").limit(1),
);

for (const table of ["push_subscriptions", "notification_preferences", "notification_events", "notification_deliveries"]) {
  await check(table, admin.from(table).select("id").limit(1));
}

console.log(`vapid_public=${process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? "present" : "missing"}`);
console.log(`vapid_private=${process.env.VAPID_PRIVATE_KEY ? "present" : "missing"}`);
console.log(`vapid_subject=${process.env.VAPID_SUBJECT ? "present" : "missing"}`);
