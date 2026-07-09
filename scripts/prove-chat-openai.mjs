/**
 * Preuve : POST /api/ai/chat (même endpoint que l’app), mode texte.
 *
 * Prérequis :
 *   - Serveur Next déjà lancé (ex. npm run dev dans apps/web)
 *   - apps/web/.env.local avec Supabase + OPENAI_API_KEY
 *   - Optionnel pour JSON de debug : lancer le serveur avec MOBOKO_CHAT_OPENAI_DEBUG=1
 *
 * Usage :
 *   node scripts/prove-chat-openai.mjs [baseUrl]
 *   baseUrl défaut : http://127.0.0.1:3000
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { Agent } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const webEnvPath = join(root, "apps", "web", ".env.local");

const localApiAgent = new Agent({
  connectTimeout: 15_000,
  headersTimeout: 130_000,
  bodyTimeout: 130_000,
});

function loadWebEnvLocal() {
  if (!existsSync(webEnvPath)) {
    throw new Error(`Manquant: ${webEnvPath}`);
  }
  const env = {};
  for (const line of readFileSync(webEnvPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

function applyToProcessEnv(parsed) {
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string" && v.length) process.env[k] = v;
  }
}

async function postChat(baseUrl, token, body) {
  const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ai/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    dispatcher: localApiAgent,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function main() {
  const fileEnv = loadWebEnvLocal();
  applyToProcessEnv(fileEnv);

  const baseUrl = process.argv[2]?.trim() || "http://127.0.0.1:3000";
  const url = fileEnv.NEXT_PUBLIC_SUPABASE_URL?.trim() || fileEnv.SUPABASE_URL?.trim();
  const anon = fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const service = fileEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const openaiKey = fileEnv.OPENAI_API_KEY?.trim();

  console.log("=== prove-chat-openai ===");
  console.log("baseUrl:", baseUrl);
  console.log("endpoint:", `${baseUrl.replace(/\/$/, "")}/api/ai/chat`);
  console.log("OPENAI_API_KEY dans .env.local :", openaiKey ? `présente (${openaiKey.length} car.)` : "ABSENTE");
  console.log(
    "Côté serveur : vérifier les lignes [chat-openai] dans la console Next (request_start, openai_status, raw_response_preview, supabase_candidate_count, rehydrated_results_count).",
  );
  console.log(
    "Pour moboko_debug_chat_openai dans le JSON : redémarrer Next avec MOBOKO_CHAT_OPENAI_DEBUG=1",
  );
  console.log("");

  if (!url || !anon || !service) {
    console.error("Secrets Supabase manquants dans apps/web/.env.local");
    process.exit(1);
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `moboko.prove.openai.${Date.now()}@example.com`;
  const password = "MobokoProve!temp8721";
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cErr || !created.user) {
    console.error("createUser:", cErr?.message);
    process.exit(1);
  }
  const userId = created.user.id;
  await admin.from("profiles").update({ credit_balance: 9999 }).eq("id", userId);

  const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: sErr } = await userClient.auth.signInWithPassword({ email, password });
  if (sErr || !sess.session) {
    console.error("signIn:", sErr?.message);
    process.exit(1);
  }
  const token = sess.session.access_token;

  const { data: conv, error: convErr } = await userClient
    .from("conversations")
    .insert({ user_id: userId, title: "prove-chat-openai" })
    .select("id")
    .single();
  if (convErr || !conv?.id) {
    console.error("conversation:", convErr?.message);
    process.exit(1);
  }

  const body = {
    conversationId: conv.id,
    mode: "text",
    text: "Montre-moi des passages sur la semence du serpent.",
  };

  console.log("Envoi POST /api/ai/chat …");
  const { status, j } = await postChat(baseUrl, token, body);

  console.log("");
  console.log("--- Réponse API Moboko ---");
  console.log("HTTP status (Next):", status);
  console.log("ok:", j.ok);
  console.log("error:", j.error ?? null);
  console.log("credits_charged:", j.credits_charged ?? null);
  console.log("balance_after:", j.balance_after ?? null);

  const dbg = j.moboko_debug_chat_openai;
  if (dbg && typeof dbg === "object") {
    console.log("");
    console.log("--- moboko_debug_chat_openai (serveur en MOBOKO_CHAT_OPENAI_DEBUG=1) ---");
    console.log(JSON.stringify(dbg, null, 2));
    console.log("OpenAI appelé (backend) :", dbg.openai_called === true ? "oui" : "non");
    console.log("openai_status :", dbg.openai_status);
    console.log("raw_response_received :", dbg.raw_response_received);
    console.log("supabase_candidate_count :", dbg.supabase_candidate_count);
    console.log("parsed_results_count :", dbg.parsed_results_count);
    console.log("rehydrated_results_count :", dbg.rehydrated_results_count);
    console.log("empty_fallback_used :", dbg.empty_fallback_used);
    console.log("fallback_search_used :", dbg.fallback_search_used);
    if (typeof dbg.output_preview === "string" && dbg.output_preview.length) {
      console.log("extrait réponse brute (400c) :", dbg.output_preview.slice(0, 200).replace(/\s+/g, " "));
    }
  } else {
    console.log("");
    console.log("(Pas de moboko_debug_chat_openai : activer MOBOKO_CHAT_OPENAI_DEBUG=1 sur le serveur Next.)");
  }

  await admin.auth.admin.deleteUser(userId);

  console.log("");
  console.log("Utilisateur de test supprimé.");
  process.exit(status >= 200 && status < 300 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
