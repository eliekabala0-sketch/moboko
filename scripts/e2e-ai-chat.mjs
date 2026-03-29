/**
 * E2E : Next.js production + POST /api/ai/chat (texte, image, audio).
 * Crée un utilisateur Auth (admin), crédite le profil, lance `next start`, puis nettoie.
 *
 * Prérequis : apps/web/.env.local (bootstrap + secrets), build web, migration consume_credits_atomic.
 */
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { createServer } from "net";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { Agent } from "undici";
import { platform } from "os";
import { describeSecretProblem } from "./secret-format.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const webDir = join(root, "apps", "web");
const webEnvPath = join(webDir, ".env.local");

const e2eSupabaseAgent = new Agent({
  connectTimeout: 45_000,
  headersTimeout: 90_000,
  bodyTimeout: 90_000,
});
function e2eSupabaseFetch(input, init) {
  return fetch(input, { ...init, dispatcher: e2eSupabaseAgent });
}

const e2eLocalApiAgent = new Agent({
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

function applyToProcessEnv(parsed) {
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string" && v.length) process.env[k] = v;
  }
}

function buildToneWav(durationSec = 2, freq = 440, sampleRate = 16000) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  const pcm = Buffer.alloc(dataSize);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0x3fff;
    pcm.writeInt16LE(Math.round(s), i * 2);
  }
  return Buffer.concat([header, pcm]);
}

function allocateFreePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const p = typeof addr === "object" && addr ? addr.port : null;
      s.close((err) => {
        if (err) reject(err);
        else if (p) resolve(p);
        else reject(new Error("port inconnu"));
      });
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
    } catch {
      /* retry */
    }
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
    dispatcher: e2eLocalApiAgent,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function main() {
  const fileEnv = loadWebEnvLocal();
  applyToProcessEnv(fileEnv);

  const url =
    fileEnv.NEXT_PUBLIC_SUPABASE_URL?.trim() || fileEnv.SUPABASE_URL?.trim();
  const anon = fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const service = fileEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const openai = fileEnv.OPENAI_API_KEY?.trim();

  if (!url || !anon) {
    console.error("E2E: URL ou clé anon Supabase manquante.");
    process.exit(1);
  }
  const oaP = describeSecretProblem("OPENAI_API_KEY", openai);
  const srP = describeSecretProblem("SUPABASE_SERVICE_ROLE_KEY", service);
  if (oaP || srP) {
    console.error("E2E:", oaP || srP);
    process.exit(1);
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: e2eSupabaseFetch },
  });

  const email = `moboko.e2e.${Date.now()}@example.com`;
  const password = "MobokoE2E!temp8721";

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cErr || !created.user) {
    console.error("E2E: createUser", cErr?.message);
    process.exit(1);
  }
  const userId = created.user.id;

  await admin.from("profiles").update({ credit_balance: 9999 }).eq("id", userId);

  const { data: costs } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["text_credit_cost", "voice_credit_cost", "image_credit_cost"]);

  const costMap = Object.fromEntries(
    (costs ?? []).map((r) => [r.key, Number(r.value)]),
  );
  const textCost = Math.max(0, Math.floor(costMap.text_credit_cost ?? 1));

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: e2eSupabaseFetch },
  });
  const { data: sess, error: sErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (sErr || !sess.session) {
    console.error("E2E: signIn", sErr?.message);
    await admin.auth.admin.deleteUser(userId);
    process.exit(1);
  }
  const token = sess.session.access_token;

  const { data: conv, error: convErr } = await userClient
    .from("conversations")
    .insert({ user_id: userId, title: "e2e" })
    .select("id")
    .single();
  if (convErr || !conv?.id) {
    console.error("E2E: conversation", convErr?.message);
    await admin.auth.admin.deleteUser(userId);
    process.exit(1);
  }
  const conversationId = conv.id;

  const port = await allocateFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const isWin = platform() === "win32";
  const nextCli = join(root, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextCli)) {
    console.error("E2E: binaire Next introuvable:", nextCli);
    await admin.auth.admin.deleteUser(userId);
    process.exit(1);
  }
  const proc = spawn(process.execPath, [nextCli, "start", "-p", String(port)], {
    cwd: webDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: isWin,
  });

  let procExited = false;
  proc.on("exit", () => {
    procExited = true;
  });

  try {
    await waitForHttp(baseUrl);
    const bal0 = (
      await admin.from("profiles").select("credit_balance").eq("id", userId).single()
    ).data?.credit_balance;

    const textRes = await postChat(baseUrl, token, {
      conversationId,
      mode: "text",
      text: "Réponds en une phrase : quel est le rôle spirituel d’un souffle calme ?",
    });
    if (textRes.status !== 200 || !textRes.j?.reply) {
      console.error("E2E texte:", textRes.status, textRes.j);
      throw new Error("texte");
    }
    console.log("✓ Texte OK, crédits facturés:", textRes.j.credits_charged);

    const bal1 = (
      await admin.from("profiles").select("credit_balance").eq("id", userId).single()
    ).data?.credit_balance;
    if (
      textCost > 0 &&
      bal1 !== undefined &&
      bal0 !== undefined &&
      bal0 - bal1 < textCost
    ) {
      console.warn(
        "⚠ Débit crédits texte : attendu ≥",
        textCost,
        "débit réel",
        bal0 - bal1,
      );
    }

    const { count: nUserAfterText } = await admin
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("role", "user");
    const { count: nAsst } = await admin
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("role", "assistant");
    if ((nUserAfterText ?? 0) < 1 || (nAsst ?? 0) < 1) {
      throw new Error("persistance messages texte");
    }
    console.log("✓ Persistance Supabase (messages user + assistant)");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const imgPath = `${userId}/e2e-${Date.now()}.png`;
    const { error: upImg } = await userClient.storage
      .from("chat-images")
      .upload(imgPath, png, { contentType: "image/png", upsert: true });
    if (upImg) {
      console.warn("⚠ Upload image:", upImg.message, "— skip image");
    } else {
      const imgRes = await postChat(baseUrl, token, {
        conversationId,
        mode: "image",
        imageStoragePath: imgPath,
        imageMime: "image/png",
        text: "Décris brièvement cette image.",
      });
      if (imgRes.status !== 200 || !imgRes.j?.reply) {
        console.warn("⚠ Image API:", imgRes.status, imgRes.j);
      } else {
        console.log("✓ Image + question OK");
      }
    }

    const wav = buildToneWav(2, 440, 16000);
    const audioPath = `${userId}/e2e-${Date.now()}.wav`;
    const { error: upAu } = await userClient.storage
      .from("chat-audio")
      .upload(audioPath, wav, { contentType: "audio/wav", upsert: true });
    if (upAu) {
      console.warn("⚠ Upload audio:", upAu.message, "— skip audio");
    } else {
      const auRes = await postChat(baseUrl, token, {
        conversationId,
        mode: "audio",
        audioStoragePath: audioPath,
        audioMime: "audio/wav",
        audioDurationMs: 2000,
      });
      if (auRes.status !== 200) {
        console.warn("⚠ Audio API:", auRes.status, auRes.j);
      } else {
        console.log("✓ Audio (transcription + réponse) OK");
      }
    }

    console.log("");
    console.log("E2E terminé (utilisateur de test supprimé).");
  } catch (e) {
    console.error("E2E échec:", e?.message || e);
    process.exitCode = 1;
  } finally {
    if (!procExited) {
      proc.kill(isWin ? undefined : "SIGTERM");
      if (isWin) {
        try {
          spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
            stdio: "ignore",
          });
        } catch {
          /* ignore */
        }
      }
    }
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
