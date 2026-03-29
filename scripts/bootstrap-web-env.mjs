/**
 * Met à jour apps/web/.env.local : URLs/clés publiques du projet + secrets serveur.
 * Secrets (fichiers, priorité croissante — les derniers écrasent les précédents) :
 *   .secrets/web.env, ~/.moboko/web-secrets.env, ~/web-secrets.env, MOBOKO_WEB_SECRETS_FILE
 * Base process.env puis fusion fichiers ; complément depuis .env.local existant si absent.
 *
 * Ne commitez pas .env.local (ignoré via apps/web/.gitignore .env*).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const webEnvPath = join(root, "apps", "web", ".env.local");

const PROJECT_PUBLIC = {
  NEXT_PUBLIC_SUPABASE_URL: "https://mtynimsoknktaywavkid.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "sb_publishable_j1afR5EW2mdEFEFLiE6wvA_7_02yrOi",
};

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function mergeSecretsFromSidecars() {
  const merged = {
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim() || "",
  };
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const extraPath = process.env.MOBOKO_WEB_SECRETS_FILE?.trim();
  const paths = [
    join(root, ".secrets", "web.env"),
    join(home, ".moboko", "web-secrets.env"),
    join(home, "web-secrets.env"),  // e.g. C:\Users\user.moboko\web-secrets.env when USERPROFILE is that folder
    ...(extraPath ? [extraPath] : []),  // MOBOKO_WEB_SECRETS_FILE wins last
  ];
  for (const p of paths) {
    const partial = parseEnvFile(p);
    if (partial.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      merged.SUPABASE_SERVICE_ROLE_KEY = partial.SUPABASE_SERVICE_ROLE_KEY.trim();
    }
    if (partial.OPENAI_API_KEY?.trim()) {
      merged.OPENAI_API_KEY = partial.OPENAI_API_KEY.trim();
    }
  }
  return merged;
}

function serializeEnv(obj) {
  const skip = new Set(["SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"]);
  const lines = [
    "# Moboko — mis à jour par npm run bootstrap:web-env",
    "# Secrets : .secrets/web.env, ~/.moboko/web-secrets.env, ~/web-secrets.env, MOBOKO_WEB_SECRETS_FILE",
    `NEXT_PUBLIC_SUPABASE_URL=${obj.NEXT_PUBLIC_SUPABASE_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${obj.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    `SUPABASE_URL=${obj.SUPABASE_URL}`,
    `SUPABASE_ANON_KEY=${obj.SUPABASE_ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${obj.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
    `OPENAI_API_KEY=${obj.OPENAI_API_KEY ?? ""}`,
  ];
  const extra = Object.keys(obj)
    .filter((k) => !skip.has(k))
    .filter(
      (k) =>
        ![
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
        ].includes(k),
    )
    .sort();
  for (const k of extra) {
    if (obj[k] != null && obj[k] !== "") lines.push(`${k}=${obj[k]}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const existing = parseEnvFile(webEnvPath);
  const sidecar = mergeSecretsFromSidecars();

  const service =
    sidecar.SUPABASE_SERVICE_ROLE_KEY ||
    existing.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  const openai =
    sidecar.OPENAI_API_KEY || existing.OPENAI_API_KEY?.trim() || "";

  const pubUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    PROJECT_PUBLIC.NEXT_PUBLIC_SUPABASE_URL;
  const pubAnon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    PROJECT_PUBLIC.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const out = {
    ...existing,
    NEXT_PUBLIC_SUPABASE_URL: pubUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: pubAnon,
    SUPABASE_URL: pubUrl,
    SUPABASE_ANON_KEY: pubAnon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    OPENAI_API_KEY: openai,
  };

  writeFileSync(webEnvPath, serializeEnv(out), "utf8");
  console.log("bootstrap-web-env →", webEnvPath);

  const home = process.env.USERPROFILE || process.env.HOME || "";
  const mobokoDir = join(home, ".moboko");
  if (!existsSync(mobokoDir)) {
    try {
      mkdirSync(mobokoDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

main();
