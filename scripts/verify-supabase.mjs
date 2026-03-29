/**
 * Environnement : lit apps/web/.env.local (NEXT_PUBLIC_*).
 * Vérifie lecture RLS anon, refus d'écriture anon, puis session utilisateur + profil.
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, "apps/web/.env.local");

function loadWebEnvLocal() {
  if (!existsSync(envPath)) {
    console.error("Fichier manquant:", envPath);
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
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
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url?.trim() || !anonKey?.trim()) {
  console.error("NEXT_PUBLIC_SUPABASE_URL ou ANON_KEY manquant dans .env.local");
  process.exit(1);
}

const supabase = createClient(url, anonKey);

function ok(msg) {
  console.log("✓", msg);
}

function fail(msg, err) {
  console.error("✗", msg);
  if (err) console.error(err);
  process.exit(1);
}

console.log("URL:", url);
console.log("");

// 1) Lecture publique app_settings
const { data: settings, error: eSettings } = await supabase
  .from("app_settings")
  .select("key, value")
  .order("key");

if (eSettings) {
  fail(
    "Lecture app_settings (anon). Vérifier que la migration est appliquée et les RLS.",
    eSettings,
  );
}
ok(`app_settings: ${settings?.length ?? 0} ligne(s) visibles (anon)`);
if (settings?.length) {
  console.log("  clés:", settings.map((r) => r.key).join(", "));
}

// 2) profiles sans JWT : 0 ligne (RLS)
const { data: noAuthProfiles, error: eProfAnon } = await supabase
  .from("profiles")
  .select("id")
  .limit(5);

if (eProfAnon) fail("Lecture profiles (anon)", eProfAnon);
if ((noAuthProfiles?.length ?? 0) > 0) {
  console.warn(
    "⚠ profiles visibles sans auth — RLS à revoir (attendu: 0 ligne).",
  );
} else {
  ok("profiles: 0 ligne sans session (RLS attendu)");
}

// 3) Écriture anon app_settings doit échouer
const { error: eInsertAnon } = await supabase.from("app_settings").insert({
  key: "__moboko_probe_delete_me__",
  value: 0,
});

if (!eInsertAnon) {
  fail("Insert anon app_settings a réussi — RLS trop permissif !");
}
ok(`app_settings: insert anon refusé (${eInsertAnon.code || "policy"})`);

// 4) Session utilisateur : compte dédié (env) ou inscription jetable
const testEmail =
  env.MOBOKO_VERIFY_EMAIL?.trim() ||
  `moboko.verify.${Date.now()}@outlook.com`;
const testPassword =
  env.MOBOKO_VERIFY_PASSWORD || "MobokoVerify!8721";

let userId;
let session;

if (env.MOBOKO_VERIFY_EMAIL?.trim()) {
  const { data: signInData, error: eIn } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (eIn) {
    fail("Connexion MOBOKO_VERIFY_EMAIL (vérifiez le mot de passe)", eIn);
  }
  session = signInData.session;
  userId = signInData.user?.id;
} else {
  const { data: signUpData, error: eSignUp } = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword,
  });

  if (eSignUp) {
    console.warn("signup:", eSignUp.message);
    console.log(
      "Pour tester l’écriture profiles : ajoutez MOBOKO_VERIFY_EMAIL et MOBOKO_VERIFY_PASSWORD dans apps/web/.env.local (compte réel), puis relancez npm run verify:supabase.",
    );
    process.exit(0);
  }

  userId = signUpData.user?.id;
  session = signUpData.session;

  if (!session) {
    const { data: signInData, error: eIn } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    if (eIn) {
      console.warn(
        "Pas de session après signup; signIn:",
        eIn.message,
        "— Désactiver la confirmation e-mail pour l’auto-test, ou utiliser MOBOKO_VERIFY_EMAIL.",
      );
      process.exit(0);
    }
    session = signInData.session;
    userId = signInData.user?.id;
  }
}

if (!userId || !session) {
  console.warn("Impossible d'obtenir une session — arrêt des tests écriture.");
  process.exit(0);
}

// Le client garde le JWT en mémoire après signUp/signIn.
const { data: myProfile, error: eMy } = await supabase
  .from("profiles")
  .select("id, display_name, role, credit_balance")
  .eq("id", userId)
  .maybeSingle();

if (eMy) fail("Lecture mon profil (JWT)", eMy);
if (!myProfile) fail("Profil absent après signup (trigger handle_new_user ?)", null);
ok(`profiles: lecture OK pour ${userId.slice(0, 8)}…`);

const newName = `Verify ${Date.now()}`;
const { error: eUp } = await supabase
  .from("profiles")
  .update({ display_name: newName })
  .eq("id", userId);

if (eUp) fail("Mise à jour display_name (propriétaire)", eUp);
ok(`profiles: update display_name → "${newName.slice(0, 20)}…"`);

const { data: after } = await supabase
  .from("profiles")
  .select("display_name")
  .eq("id", userId)
  .single();

if (after?.display_name !== newName) {
  fail("Relecture profil après update incohérente", after);
}
ok("profiles: relecture cohérente après écriture");

console.log("");
console.log("Résumé : connexion réelle OK (lecture publique + session + profil).");
if (!env.MOBOKO_VERIFY_EMAIL?.trim()) {
  console.log(`Compte test créé : ${testEmail} (supprimez-le dans Auth > Users si besoin).`);
}
