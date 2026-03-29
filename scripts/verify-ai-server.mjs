/**
 * Vérifie OPENAI_API_KEY et SUPABASE_SERVICE_ROLE_KEY (hors bundle client).
 * Lit apps/web/.env.local puis teste OpenAI (GET models, sans imposer un modèle chat) et Supabase (service).
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { describeSecretProblem } from "./secret-format.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const webEnvPath = join(root, "apps", "web", ".env.local");

function loadWebEnvLocal() {
  if (!existsSync(webEnvPath)) {
    console.error("Manquant:", webEnvPath, "— lancez npm run bootstrap:web-env");
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(webEnvPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadWebEnvLocal();
const openaiKey = env.OPENAI_API_KEY?.trim();
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const url =
  env.NEXT_PUBLIC_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim() || "";

let failed = false;
if (!url?.trim()) {
  console.error("✗ URL Supabase absente (NEXT_PUBLIC_SUPABASE_URL)");
  failed = true;
}
const oaProblem = describeSecretProblem("OPENAI_API_KEY", openaiKey);
const srProblem = describeSecretProblem("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
if (oaProblem) {
  console.error("✗", oaProblem);
  failed = true;
}
if (srProblem) {
  console.error("✗", srProblem);
  failed = true;
}
if (failed) {
  console.error(
    "\nSources supportées : variables d’environnement, %USERPROFILE%\\web-secrets.env, %USERPROFILE%\\.moboko\\web-secrets.env, .secrets/web.env, MOBOKO_WEB_SECRETS_FILE.",
  );
  process.exit(1);
}

const openai = new OpenAI({ apiKey: openaiKey });
try {
  const list = await openai.models.list();
  const n = list?.data?.length ?? 0;
  if (n < 1) throw new Error("liste modèles vide");
  console.log("✓ OpenAI: clé valide, accès API modèles OK (" + n + " modèles visibles)");
} catch (e) {
  console.error("✗ OpenAI:", e?.message || e);
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: rows, error } = await admin
  .from("app_settings")
  .select("key")
  .limit(1);

if (error) {
  console.error("✗ Supabase service_role:", error.message);
  process.exit(1);
}
console.log("✓ Supabase service_role: lecture app_settings OK", rows?.length ?? 0);
