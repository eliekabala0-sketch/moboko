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

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) args.set(key, "true");
  else {
    args.set(key, next);
    i += 1;
  }
}

const category = args.get("category");
const dryRun = args.get("dry-run") !== "false";

const admin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

if (dryRun) {
  let preview = admin
    .from("audio_items")
    .select("id, category, title, import_status, storage_path", { count: "exact" })
    .in("import_status", ["uploaded", "verified"])
    .not("storage_path", "is", null)
    .limit(10);
  if (category === "sermon" || category === "prayer_line") preview = preview.eq("category", category);
  const { data, count, error } = await preview;
  if (error) throw error;
  console.log(`dry_run=true eligible=${count ?? 0}`);
  for (const item of data ?? []) console.log(`${item.category} ${item.title}`);
  process.exit(0);
}

async function activateOne(nextCategory) {
  const { data, count, error } = await admin
    .from("audio_items")
    .update({
      is_active: true,
      streaming_enabled: true,
      offline_enabled: true,
      full_download_enabled: nextCategory === "sermon",
    })
    .eq("category", nextCategory)
    .in("import_status", ["uploaded", "verified"])
    .not("storage_path", "is", null)
    .select("id", { count: "exact" });
  if (error) throw error;
  return count ?? data?.length ?? 0;
}

const categories = category === "sermon" || category === "prayer_line" ? [category] : ["sermon", "prayer_line"];
let total = 0;
for (const nextCategory of categories) {
  const count = await activateOne(nextCategory);
  total += count;
  console.log(`${nextCategory}=${count}`);
}
console.log(`activated=${total}`);
