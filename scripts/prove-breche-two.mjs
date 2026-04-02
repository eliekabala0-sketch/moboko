import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { createServer } from "net";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { Agent } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const webDir = join(root, "apps", "web");
const webEnvPath = join(webDir, ".env.local");

const localApiAgent = new Agent({
  connectTimeout: 15_000,
  headersTimeout: 130_000,
  bodyTimeout: 130_000,
});

function loadWebEnvLocal() {
  if (!existsSync(webEnvPath)) throw new Error(`Manquant: ${webEnvPath}`);
  const env = {};
  for (const line of readFileSync(webEnvPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

function applyToProcessEnv(parsed) {
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string" && v.length) process.env[k] = v;
  }
}

function allocateFreePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const p = typeof addr === "object" && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(p)));
    });
    s.on("error", reject);
  });
}

async function waitForHttp(url, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { method: "GET", redirect: "manual" });
      if (r.status >= 100 && r.status < 600) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout serveur: ${url}`);
}

async function postChat(baseUrl, token, body) {
  const r = await fetch(`${baseUrl}/api/ai/chat`, {
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

const Q1 =
  "dans le sermon La Brèche entre les sept âges de l’Eglise et les sept Sceaux, trouve où il explique Apocalypse 10, juste dans ce sermon";
const Q2 = "tu as bien le sermon la breche, ouvre le paragraphe 42";

function scopeSlugFromMeta(m) {
  const r = m?.moboko_retrieval;
  if (!r || typeof r !== "object") return null;
  const s = r.scope;
  if (!s || typeof s !== "object" || s.kind !== "sermon") return null;
  return String(s.sermon_slug ?? "").trim() || null;
}

function firstHitSlug(m) {
  const results = m?.results;
  if (!Array.isArray(results) || !results[0]) return null;
  return String(results[0].slug ?? "").trim() || null;
}

async function main() {
  const fileEnv = loadWebEnvLocal();
  applyToProcessEnv(fileEnv);
  const url = fileEnv.NEXT_PUBLIC_SUPABASE_URL?.trim() || fileEnv.SUPABASE_URL?.trim();
  const anon = fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const service = fileEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anon || !service) throw new Error("Secrets Supabase manquants");

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `moboko.breche.${Date.now()}@example.com`;
  const password = "MobokoProof!temp8721";
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr || !created.user) throw new Error(`createUser: ${cErr?.message}`);
  const userId = created.user.id;
  await admin.from("profiles").update({ credit_balance: 9999 }).eq("id", userId);

  const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: sErr } = await userClient.auth.signInWithPassword({ email, password });
  if (sErr || !sess.session) throw new Error(`signIn: ${sErr?.message}`);
  const token = sess.session.access_token;

  const { data: conv, error: convErr } = await userClient
    .from("conversations")
    .insert({ user_id: userId, title: "proof-breche-two" })
    .select("id")
    .single();
  if (convErr || !conv?.id) throw new Error(`conversation: ${convErr?.message}`);

  const port = await allocateFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextCli = join(root, "node_modules", "next", "dist", "bin", "next");
  const proc = spawn(process.execPath, [nextCli, "start", "-p", String(port)], {
    cwd: webDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stdout.write(`[next] ${String(d)}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[next-err] ${String(d)}`));

  try {
    await waitForHttp(baseUrl);

    console.log("\n[proof-breche] Q1:", Q1);
    const r1 = await postChat(baseUrl, token, { conversationId: conv.id, mode: "text", text: Q1 });
    if (r1.status !== 200) throw new Error(`Q1 status ${r1.status}`);
    const { data: a1 } = await admin
      .from("messages")
      .select("metadata")
      .eq("conversation_id", conv.id)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const m1 = a1?.metadata && typeof a1.metadata === "object" ? a1.metadata : {};
    const slug1 = scopeSlugFromMeta(m1) ?? firstHitSlug(m1);
    console.log("[proof-breche] Q1 scope/hit slug:", slug1);
    if (!slug1 || !slug1.includes("la-breche-entre-les-sept-ages")) {
      throw new Error(`Q1: slug inattendu (attendu *la-breche-entre-les-sept-ages*): ${slug1}`);
    }
    if (slug1.includes("se-tenir-a-la-breche")) throw new Error(`Q1: mauvais sermon (se-tenir): ${slug1}`);

    console.log("\n[proof-breche] Q2:", Q2);
    const r2 = await postChat(baseUrl, token, { conversationId: conv.id, mode: "text", text: Q2 });
    if (r2.status !== 200) throw new Error(`Q2 status ${r2.status}`);
    const { data: a2 } = await admin
      .from("messages")
      .select("metadata")
      .eq("conversation_id", conv.id)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const m2 = a2?.metadata && typeof a2.metadata === "object" ? a2.metadata : {};
    const slug2 = scopeSlugFromMeta(m2) ?? firstHitSlug(m2);
    console.log("[proof-breche] Q2 scope/hit slug:", slug2);
    if (slug2 !== slug1) {
      throw new Error(`Continuité: Q2 slug ${slug2} !== Q1 slug ${slug1}`);
    }
    if (slug2.includes("se-tenir-a-la-breche")) throw new Error(`Q2: mauvais sermon (se-tenir): ${slug2}`);

    const pn = Array.isArray(m2.results) && m2.results[0] ? m2.results[0].paragraph_number : null;
    if (pn !== 42) throw new Error(`Q2: attendu paragraphe 42, reçu ${pn}`);

    console.log("\n[proof-breche] OK — même sermon canonique et §42 dans le scope actif.");
  } finally {
    proc.kill();
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((e) => {
  console.error("[proof-breche] FAIL", e);
  process.exit(1);
});
