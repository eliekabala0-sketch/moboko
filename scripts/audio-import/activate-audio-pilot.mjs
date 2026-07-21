import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PILOT_FILES = [
  "FRN63-1226 Church Order VGR.mp3",
  "FRN63-1226 Church Order VGR.m4a",
  "FRN64-0305 Perseverant VGR.mp3",
  "FRN65-0221 M Marriage And Divorce VGR.mp3",
  "FRN64-0802 Future Home VGR.mp3",
  "FRN65-0221E Who Is This Melchisedec VGR.mp3",
];

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

const { data: items, error } = await admin
  .from("audio_items")
  .select("id, category, title, original_filename, file_size, sermon_id, sermon_match_status, storage_path")
  .in("original_filename", PILOT_FILES)
  .in("import_status", ["uploaded", "verified"]);

if (error) throw error;

for (const item of items ?? []) {
  const { error: updateError } = await admin
    .from("audio_items")
    .update({
      is_active: true,
      streaming_enabled: true,
      offline_enabled: true,
      full_download_enabled: item.category === "sermon",
      import_status: "verified",
    })
    .eq("id", item.id);
  if (updateError) throw updateError;
  console.log(
    `${item.category}|${item.original_filename}|size=${item.file_size}|match=${item.sermon_match_status}|sermon=${Boolean(item.sermon_id)}`,
  );
}

console.log(`activated=${items?.length ?? 0}`);
