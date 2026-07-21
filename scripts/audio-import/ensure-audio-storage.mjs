import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "sermon-audio";
const ALLOWED_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/flac",
  "audio/ogg",
  "audio/opus",
  "application/json",
  "application/octet-stream",
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

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data: existing, error: readError } = await supabase.storage.getBucket(BUCKET);

if (readError) {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });
  if (error) throw error;
  console.log(`${BUCKET}=created public=false`);
} else {
  const { error } = await supabase.storage.updateBucket(BUCKET, {
    public: false,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });
  if (error) throw error;
  console.log(`${BUCKET}=updated public=${existing.public}`);
}

const { data: verified, error: verifyError } = await supabase.storage.getBucket(BUCKET);
if (verifyError) throw verifyError;
console.log(`${BUCKET}=ok public=${verified.public}`);
