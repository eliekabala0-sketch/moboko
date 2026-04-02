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

const QUERIES = [
  "dans le sermon La Brèche entre les sept âges de l’Eglise et les sept Sceaux, trouve où il explique Apocalypse 10, juste dans ce sermon",
  "tu as bien le sermon la breche, ouvre le paragraphe 42",
  "renvoie les paragraphes où il parle de l’ange puissant d’apocalypse 10",
];

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
  const email = `moboko.proof.${Date.now()}@example.com`;
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
    .insert({ user_id: userId, title: "proof-chat-tools" })
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
    for (const query of QUERIES) {
      console.log("\n[proof] query:", query);
      const res = await postChat(baseUrl, token, {
        conversationId: conv.id,
        mode: "text",
        text: query,
      });
      console.log("[proof] status:", res.status);
      console.log("[proof] response keys:", Object.keys(res.j ?? {}));
      const { data: lastAsst } = await admin
        .from("messages")
        .select("id, metadata")
        .eq("conversation_id", conv.id)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const meta = lastAsst?.metadata ?? {};
      const m = meta && typeof meta === "object" ? meta : {};
      console.log("[proof] assistant.moboko_kind:", m.moboko_kind ?? null);
      console.log("[proof] assistant.moboko_tool:", m.moboko_tool ?? null);
      console.log("[proof] total_count:", m.total_count ?? null, "results_len:", Array.isArray(m.results) ? m.results.length : 0);
    }
  } finally {
    proc.kill();
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((e) => {
  console.error("[proof] error", e);
  process.exit(1);
});

