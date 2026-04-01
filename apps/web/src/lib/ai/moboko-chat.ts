import OpenAI, { APIConnectionTimeoutError } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { readFileSync } from "node:fs";
import path from "node:path";

const FALLBACK_SYSTEM_PROMPT = `Tu es Moboko, assistant spirituel orienté Bible et sermons de William Marrion Branham.
Réponds en français sauf demande contraire, avec douceur, prudence doctrinale, sans inventer de sources.`;

let CACHED_SYSTEM_PROMPT: string | null = null;

function loadSystemPromptFromFile(): string | null {
  try {
    const p = path.resolve(process.cwd(), "src/lib/ai/moboko-system-prompt.md");
    const raw = readFileSync(p, "utf8");
    const text = raw.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function getMobokoSystemPrompt(): string {
  if (CACHED_SYSTEM_PROMPT) return CACHED_SYSTEM_PROMPT;
  CACHED_SYSTEM_PROMPT = loadSystemPromptFromFile() ?? FALLBACK_SYSTEM_PROMPT;
  return CACHED_SYSTEM_PROMPT;
}

export type DbMessageRow = {
  role: string;
  kind: string;
  content: string | null;
  metadata?: Record<string, unknown> | null;
};

export function historyToOpenAIMessages(
  history: DbMessageRow[],
): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [
    { role: "system", content: getMobokoSystemPrompt() },
  ];
  for (const m of history) {
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content || "" });
      continue;
    }
    if (m.role !== "user") continue;
    if (m.kind === "text") {
      out.push({ role: "user", content: m.content || "" });
    } else if (m.kind === "image") {
      out.push({
        role: "user",
        content: `[Image] ${(m.content || "").trim() || "(sans légende)"}`,
      });
    } else if (m.kind === "audio") {
      out.push({
        role: "user",
        content: `[Message vocal] ${(m.content || "").trim() || "(transcription indisponible)"}`,
      });
    }
  }
  return out;
}

/** Lit uniquement `process.env.OPENAI_API_KEY` (serveur / Railway). Aucun fallback vers fichier ou clé publique. */
function readOpenAIApiKey(): string | null {
  let key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  if (key.toLowerCase().startsWith("bearer ")) {
    key = key.slice(7).trim();
  }
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key || null;
}

export function getOpenAIClient() {
  const key = readOpenAIApiKey();
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    timeout: 110_000,
    maxRetries: 3,
  });
}

export function getChatModel() {
  return process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini";
}

function chatModelFallbacks(primary: string): string[] {
  const extras = ["gpt-4o", "gpt-3.5-turbo"];
  const out = [primary];
  for (const m of extras) {
    if (m !== primary) out.push(m);
  }
  return out;
}

async function chatCompletionCreateOnce(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
) {
  const params = {
    model,
    messages,
    temperature: 0.6,
    max_tokens: 2048,
  };
  try {
    return await openai.chat.completions.create(params);
  } catch (e) {
    if (e instanceof APIConnectionTimeoutError) {
      await new Promise((r) => setTimeout(r, 400));
      return await openai.chat.completions.create(params);
    }
    throw e;
  }
}

function isModelAccessError(e: unknown): boolean {
  const err = e as { status?: number; message?: string };
  const msg = (err?.message ?? String(e)).toLowerCase();
  if (err?.status === 403) return true;
  return (
    msg.includes("does not have access") ||
    msg.includes("model_not_found") ||
    (msg.includes("model") && msg.includes("not found"))
  );
}

export async function transcribeAudio(
  openai: OpenAI,
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<string> {
  const { toFile } = await import("openai/uploads");
  const file = await toFile(buffer, filename, { type: mime });
  const createTr = () =>
    openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "fr",
    });
  try {
    const tr = await createTr();
    return tr.text?.trim() || "";
  } catch (e) {
    if (e instanceof APIConnectionTimeoutError) {
      await new Promise((r) => setTimeout(r, 400));
      const tr = await createTr();
      return tr.text?.trim() || "";
    }
    throw e;
  }
}

export async function runChatCompletion(
  openai: OpenAI,
  messages: ChatCompletionMessageParam[],
): Promise<string> {
  const models = chatModelFallbacks(getChatModel());
  let lastErr: unknown;
  for (const model of models) {
    try {
      const completion = await chatCompletionCreateOnce(openai, model, messages);
      const text = completion.choices[0]?.message?.content?.trim() || "";
      return text;
    } catch (e) {
      lastErr = e;
      const err = e as { status?: number };
      if (err?.status === 401 || err?.status === 429) throw e;
      if (!isModelAccessError(e)) throw e;
    }
  }
  throw lastErr;
}

/** Réponse JSON stricte (ex. recherche structurée). Même modèle / fallbacks que le chat. */
export async function runStructuredJsonCompletion(
  openai: OpenAI,
  messages: ChatCompletionMessageParam[],
  options?: { maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<string> {
  const max_tokens = options?.maxTokens ?? 1400;
  const temperature = options?.temperature ?? 0.2;
  const reqOptions = options?.timeoutMs != null ? { timeout: options.timeoutMs } : undefined;
  const models = chatModelFallbacks(getChatModel());
  let lastErr: unknown;
  for (const model of models) {
    try {
      const completion = await openai.chat.completions.create(
        {
          model,
          messages,
          temperature,
          max_tokens,
          response_format: { type: "json_object" },
        },
        reqOptions,
      );
      const text = completion.choices[0]?.message?.content?.trim() || "";
      return text;
    } catch (e) {
      lastErr = e;
      const err = e as { status?: number };
      if (err?.status === 401 || err?.status === 429) throw e;
      if (!isModelAccessError(e)) throw e;
    }
  }
  throw lastErr;
}
