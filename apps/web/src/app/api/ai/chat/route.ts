import {
  getChatModel,
  getMobokoSystemPrompt,
  getOpenAIClient,
  historyToOpenAIMessages,
  runChatCompletion,
  transcribeAudio,
  type DbMessageRow,
} from "@/lib/ai/moboko-chat";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { tool_continue_last_scope } from "@/lib/chat/sermon-retrieval-tools";
import { runOpenAiSermonAgent } from "@/lib/chat/openai-sermon-agent";
import { ensureMonthlySubscriptionCredits } from "@/lib/billing/subscription-credits";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { fetchSingleParagraphCandidate } from "@/lib/sermons/retrieval-direct";
import { attachLinkedSermonAudio } from "@/lib/sermons/linked-audio";
import { expandConcordanceSegments, type ConcordanceHit } from "@/lib/sermons/concordance-types";
import { requestedMedia, searchActiveSermonAudio } from "@/lib/audio/search";
import { getAudioAccess } from "@/lib/audio/access";
import {
  ALL_PUBLIC_APP_SETTING_KEYS,
  parseAppSettingScalar,
  PUBLIC_APP_SETTING_KEYS,
} from "@moboko/shared";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function generateConversationTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (lower.includes("une seule chair")) return "Une seule chair dans le mariage";
  if (lower.includes("mariage") && (lower.includes("predicateur") || lower.includes("ministre") || lower.includes("pasteur"))) {
    return "Mariage d'un predicateur";
  }
  if (lower.includes("sept tonnerres") || lower.includes("sept tonnerre")) return "Sept Tonnerres";
  if (lower.includes("apocalypse 10") && lower.includes("breche")) return "Apocalypse 10 dans La Breche";
  const words = normalized
    .replace(/[?!.:;]+$/g, "")
    .split(" ")
    .filter((w) => w.length > 1)
    .slice(0, 7);
  return words.join(" ").slice(0, 64) || "Nouvelle discussion";
}

type Body = {
  conversationId: string;
  mode: "text" | "image" | "audio" | "concordance_page";
  text?: string;
  query?: string;
  offset?: number;
  pageSize?: number;
  listId?: string;
  assistantMessageId?: string;
  imageStoragePath?: string;
  imageMime?: string;
  audioStoragePath?: string;
  audioMime?: string;
  audioDurationMs?: number;
};

const CONCORDANCE_PAGE_SIZE = 20;

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const conversationId = typeof o.conversationId === "string" ? o.conversationId : "";
  const mode = o.mode;
  if (
    !conversationId ||
    (mode !== "text" && mode !== "image" && mode !== "audio" && mode !== "concordance_page")
  ) {
    return null;
  }
  const offset = typeof o.offset === "number" && Number.isFinite(o.offset) ? Math.max(0, Math.floor(o.offset)) : 0;
  const requestedPageSize =
    typeof o.pageSize === "number" && Number.isFinite(o.pageSize)
      ? Math.floor(o.pageSize)
      : CONCORDANCE_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(50, requestedPageSize));
  return {
    conversationId,
    mode,
    text: typeof o.text === "string" ? o.text : undefined,
    query: typeof o.query === "string" ? o.query : undefined,
    listId: typeof o.listId === "string" ? o.listId : undefined,
    assistantMessageId: typeof o.assistantMessageId === "string" ? o.assistantMessageId : undefined,
    offset,
    pageSize,
    imageStoragePath:
      typeof o.imageStoragePath === "string" ? o.imageStoragePath : undefined,
    imageMime: typeof o.imageMime === "string" ? o.imageMime : undefined,
    audioStoragePath:
      typeof o.audioStoragePath === "string" ? o.audioStoragePath : undefined,
    audioMime: typeof o.audioMime === "string" ? o.audioMime : undefined,
    audioDurationMs:
      typeof o.audioDurationMs === "number" ? o.audioDurationMs : undefined,
  };
}

function pathBelongsToUser(path: string, userId: string) {
  return path.startsWith(`${userId}/`);
}

const EMPTY_CONCORDANCE_MESSAGE = "Aucun sermon texte trouvé dans la base Moboko.";
const EMPTY_AUDIO_MESSAGE = "Aucun sermon audio trouvé dans la base Moboko.";
const BIBLE_INTENT_WORDS = ["bible", "verset", "versets", "ecriture", "ecritures", "scripture", "scriptures"];
const SERMON_INTENT_WORDS = ["prophete", "proph�te", "branham", "message", "messages", "sermon", "sermons", "citation", "citations"];

function normalizeIntent(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function wantsBibleOnly(value: string) {
  const text = normalizeIntent(value);
  if (text.includes("bible uniquement") || text.includes("versets uniquement")) return true;
  if (text.includes("que dit la bible") || text.includes("selon la bible")) return true;
  const bible = BIBLE_INTENT_WORDS.some((word) => text.includes(word));
  const sermon = SERMON_INTENT_WORDS.some((word) => text.includes(word));
  return bible && !sermon;
}

function wantsMessagesOnly(value: string) {
  const text = normalizeIntent(value);
  if (text.includes("messages uniquement") || text.includes("citations uniquement")) return true;
  if (text.includes("sans la bible") || text.includes("pas de verset")) return true;
  const bible = BIBLE_INTENT_WORDS.some((word) => text.includes(word));
  const sermon = SERMON_INTENT_WORDS.some((word) => text.includes(word));
  return sermon && !bible;
}

function wantsBibleAndMessages(value: string) {
  const text = normalizeIntent(value);
  if (wantsBibleOnly(value) || wantsMessagesOnly(value)) return false;
  if (text.includes("bible et messages") || text.includes("bible et les messages")) return true;
  if (text.includes("passages bibliques") && SERMON_INTENT_WORDS.some((word) => text.includes(word))) return true;
  if (text.includes("donne moi aussi") && BIBLE_INTENT_WORDS.some((word) => text.includes(word))) return true;
  return false;
}

function bibleSearchTerms(value: string) {
  return normalizeIntent(value)
    .replace(/\b(que|dit|la|le|les|des|du|de|dans|sur|selon|bible|versets?|ecritures?|uniquement|cherche|chercher|passages?|concernant)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .slice(0, 6);
}

async function fetchBibleContext(admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>, query: string) {
  const terms = bibleSearchTerms(query);
  const first = terms[0] ?? normalizeIntent(query).slice(0, 40);
  if (!first || first.length < 2) return [];
  const clauses = ["text.ilike.%" + first + "%"];
  if (terms[1]) clauses.push("text.ilike.%" + terms[1] + "%");
  const { data } = await admin
    .from("bible_passages")
    .select("translation, book, chapter, verse, text, book_number")
    .eq("translation", "LSG1910")
    .or(clauses.join(","))
    .order("book_number", { ascending: true })
    .order("chapter", { ascending: true })
    .order("verse", { ascending: true })
    .limit(80);
  const normTerms = terms.length > 0 ? terms : [first];
  return ((data ?? []) as Array<{ translation: string; book: string; chapter: number; verse: number; text: string }>)
    .filter((row) => {
      const text = normalizeIntent(row.text);
      return normTerms.some((term) => text.includes(term));
    })
    .slice(0, 8);
}

function formatBibleSection(hits: Awaited<ReturnType<typeof fetchBibleContext>>) {
  if (hits.length === 0) return "Dans la Bible\nAucun verset exact retrouve dans la bibliotheque locale pour cette formulation.";
  return [
    "Dans la Bible",
    ...hits.map((hit) => `${hit.book} ${hit.chapter}:${hit.verse} - ${hit.text}`),
  ].join("\n");
}

function coerceStoredRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const refs: Array<{ slug: string; paragraph_number: number }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    const paragraphNumber = Math.floor(Number(row.paragraph_number));
    const key = `${slug}:${paragraphNumber}`;
    if (!slug || !Number.isFinite(paragraphNumber) || paragraphNumber < 1 || seen.has(key)) continue;
    seen.add(key);
    refs.push({ slug, paragraph_number: paragraphNumber });
  }
  return refs;
}

async function rehydrateStoredRefs(
  admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  refs: Array<{ slug: string; paragraph_number: number }>,
  meta: {
    query: string;
    conversationId: string;
    offset: number;
    pageSize: number;
    totalCount: number;
    hasMore: boolean;
    nextOffset: number | null;
    audioStreamingAllowed: boolean;
  },
) {
  const out: Record<string, unknown>[] = [];
  for (const ref of refs) {
    const c = await fetchSingleParagraphCandidate(admin, ref.slug, ref.paragraph_number);
    if (!c) continue;
    const n = await fetchNeighborParagraphs(admin, c.slug, c.paragraph_number);
    out.push({
      slug: c.slug,
      title: c.title,
      year: c.year,
      preached_on: c.preached_on,
      location: c.location ?? null,
      paragraph_number: c.paragraph_number,
      paragraph_text: c.paragraph_text,
      prev_paragraph_number: n.prev_paragraph_number,
      prev_paragraph_text: n.prev_paragraph_text,
      next_paragraph_number: n.next_paragraph_number,
      next_paragraph_text: n.next_paragraph_text,
      _source: "chat",
      _query: meta.query,
      _conversation_id: meta.conversationId,
      _offset: meta.offset,
      _page_size: meta.pageSize,
      _next_offset: meta.nextOffset,
      _has_more: meta.hasMore,
      _total_count: meta.totalCount,
    });
  }
  return expandConcordanceSegments((await attachLinkedSermonAudio(admin, out, meta.audioStreamingAllowed)) as ConcordanceHit[]);
}

export async function POST(request: Request) {
  const openai = getOpenAIClient();
  const admin = createSupabaseServiceClient();
  if (!admin) {
    return NextResponse.json(
      { error: "service_supabase_manquant", detail: "SUPABASE_SERVICE_ROLE_KEY requise." },
      { status: 500 },
    );
  }

  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) {
    return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  }
  const userAudioAccess = await getAudioAccess(admin, user);

  let body: Body;
  try {
    const json = (await request.json()) as unknown;
    const p = parseBody(json);
    if (!p) {
      return NextResponse.json({ error: "corps_invalide" }, { status: 400 });
    }
    body = p;
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .select("id, user_id, title")
    .eq("id", body.conversationId)
    .maybeSingle();

  if (convErr || !conv || conv.user_id !== user.id) {
    return NextResponse.json({ error: "conversation_inaccessible" }, { status: 403 });
  }

  if (body.mode === "concordance_page") {
    const query = (body.query ?? "").trim();
    if (!query) {
      return NextResponse.json({ error: "requete_pagination_invalide" }, { status: 400 });
    }
    const offset = Math.max(0, Math.floor(body.offset ?? 0));
    const pageSize = Math.max(1, Math.min(50, Math.floor(body.pageSize ?? CONCORDANCE_PAGE_SIZE)));
    // Pagination : pas besoin de rappeler l’IA ; on réutilise le dernier scope enregistré.
    const { data: recent } = await admin
      .from("messages")
      .select("role, metadata")
      .eq("conversation_id", body.conversationId)
      .order("created_at", { ascending: false })
      .limit(30);
    let lastScope: unknown = null;
    let lastQuery: string | null = null;
    let expectedTotal: number | null = null;
    let storedRefs: Array<{ slug: string; paragraph_number: number }> = [];
    if (body.assistantMessageId) {
      const { data: messageRow } = await admin
        .from("messages")
        .select("metadata")
        .eq("id", body.assistantMessageId)
        .eq("conversation_id", body.conversationId)
        .eq("role", "assistant")
        .maybeSingle();
      const meta =
        messageRow?.metadata && typeof messageRow.metadata === "object" && !Array.isArray(messageRow.metadata)
          ? (messageRow.metadata as Record<string, unknown>)
          : null;
      const retrieval =
        meta?.moboko_retrieval && typeof meta.moboko_retrieval === "object" && !Array.isArray(meta.moboko_retrieval)
          ? (meta.moboko_retrieval as Record<string, unknown>)
          : null;
      const listMatches =
        !body.listId || String(retrieval?.list_id ?? meta?.moboko_list_id ?? "") === body.listId;
      if (retrieval && listMatches) {
        lastQuery = typeof retrieval.query === "string" ? retrieval.query.trim() : null;
        lastScope = retrieval.scope;
        expectedTotal =
          typeof retrieval.total_count === "number" && Number.isFinite(retrieval.total_count)
            ? Math.max(0, Math.floor(retrieval.total_count))
            : null;
        const state =
          meta?.moboko_assistant_state &&
          typeof meta.moboko_assistant_state === "object" &&
          !Array.isArray(meta.moboko_assistant_state)
            ? (meta.moboko_assistant_state as Record<string, unknown>)
            : null;
        const lists =
          state?.result_lists && typeof state.result_lists === "object" && !Array.isArray(state.result_lists)
            ? (state.result_lists as Record<string, unknown>)
            : null;
        const storedList =
          body.listId && lists?.[body.listId] && typeof lists[body.listId] === "object" && !Array.isArray(lists[body.listId])
            ? (lists[body.listId] as Record<string, unknown>)
            : null;
        storedRefs = coerceStoredRefs(storedList?.references);
      }
    }
    if (storedRefs.length > offset) {
      const pageRefs = storedRefs.slice(offset, offset + pageSize);
      const end = offset + pageRefs.length;
      const storedTotal = Math.max(expectedTotal ?? storedRefs.length, storedRefs.length);
      const hasMore = end < storedRefs.length;
      const nextOffset = hasMore ? end : null;
      const results = await rehydrateStoredRefs(admin, pageRefs, {
        query: lastQuery ?? query,
        conversationId: body.conversationId,
        offset,
        pageSize,
        totalCount: storedTotal,
        hasMore,
        nextOffset,
        audioStreamingAllowed: userAudioAccess.audio_streaming,
      });
      return NextResponse.json({
        ok: true,
        results,
        total_count: storedTotal,
        offset,
        page_size: pageSize,
        has_more: hasMore,
        next_offset: nextOffset,
        message: results.length === 0 ? EMPTY_CONCORDANCE_MESSAGE : null,
      });
    }
    for (const r of recent ?? []) {
      if (lastQuery) break;
      const row = r as { role?: string; metadata?: unknown };
      if (row.role !== "assistant") continue;
      const meta =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;
      const last =
        meta?.moboko_retrieval && typeof meta.moboko_retrieval === "object" && !Array.isArray(meta.moboko_retrieval)
          ? (meta.moboko_retrieval as Record<string, unknown>)
          : null;
      if (!last) continue;
      const q = typeof last.query === "string" ? last.query.trim() : "";
      const sc = last.scope;
      if (q) {
        lastQuery = q;
        lastScope = sc;
        break;
      }
    }
    const initialScope =
      lastScope && typeof lastScope === "object" && !Array.isArray(lastScope) && (lastScope as Record<string, unknown>).kind === "sermon"
        ? { kind: "sermon" as const, sermon_slug: String((lastScope as Record<string, unknown>).sermon_slug ?? "").trim() }
        : { kind: "library" as const };
    let result = await tool_continue_last_scope(admin, {
      last_scope: initialScope,
      last_query: lastQuery ?? query,
      next_offset: offset,
      page_size: pageSize,
      conversation_id: body.conversationId,
    });
    if (result.results.length === 0 && offset > 0 && initialScope.kind === "sermon") {
      result = await tool_continue_last_scope(admin, {
        last_scope: { kind: "library" },
        last_query: lastQuery ?? query,
        next_offset: offset,
        page_size: pageSize,
        conversation_id: body.conversationId,
      });
    }
    const visibleTotal = expectedTotal == null ? result.total_count : Math.min(expectedTotal, result.total_count);
    const allowedCount = expectedTotal == null ? result.results.length : Math.max(0, visibleTotal - offset);
    const visibleResults = result.results.slice(0, allowedCount);
    const end = offset + visibleResults.length;
    const hasMore = expectedTotal == null ? result.has_more : end < visibleTotal;
    const nextOffset = hasMore ? end : null;
    const enrichedVisibleResults = expandConcordanceSegments(
      (await attachLinkedSermonAudio(admin, visibleResults, userAudioAccess.audio_streaming)) as ConcordanceHit[],
    );
    return NextResponse.json({
      ok: true,
      results: enrichedVisibleResults,
      total_count: visibleTotal,
      offset: result.offset,
      page_size: result.page_size,
      has_more: hasMore,
      next_offset: nextOffset,
      message: visibleResults.length === 0 ? EMPTY_CONCORDANCE_MESSAGE : null,
    });
  }

  if (!openai) {
    console.log("[chat-openai] missing_api_key");
    return NextResponse.json(
      { error: "openai_non_configure", detail: "OPENAI_API_KEY manquante côté serveur." },
      { status: 503 },
    );
  }

  const { data: settingRows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ALL_PUBLIC_APP_SETTING_KEYS);

  const settings: Record<string, ReturnType<typeof parseAppSettingScalar>> = {};
  for (const k of ALL_PUBLIC_APP_SETTING_KEYS) {
    settings[k] = null;
  }
  for (const row of settingRows ?? []) {
    settings[row.key] = parseAppSettingScalar(row.value);
  }

  const chatText = Boolean(settings[PUBLIC_APP_SETTING_KEYS.chatTextEnabled]);
  const chatVoice = Boolean(settings[PUBLIC_APP_SETTING_KEYS.chatVoiceEnabled]);
  const chatImage = Boolean(settings[PUBLIC_APP_SETTING_KEYS.chatImageEnabled]);
  const costText = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.textCreditCost] ?? 1)),
  );
  const costVoice = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.voiceCreditCost] ?? 2)),
  );
  const costImage = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.imageCreditCost] ?? 3)),
  );
  const subscriptionMonthlyCredits = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.subscriptionMonthlyAiCredits] ?? 0)),
  );

  if (body.mode === "text" && !chatText) {
    return NextResponse.json({ error: "chat_texte_desactive" }, { status: 403 });
  }
  if (body.mode === "image" && !chatImage) {
    return NextResponse.json({ error: "chat_image_desactive" }, { status: 403 });
  }
  if (body.mode === "audio" && !chatVoice) {
    return NextResponse.json({ error: "chat_voix_desactive" }, { status: 403 });
  }

  let creditCost = 0;
  if (body.mode === "text") creditCost = costText;
  else if (body.mode === "image") creditCost = costImage;
  else creditCost = costVoice;

  await ensureMonthlySubscriptionCredits(admin, user.id, subscriptionMonthlyCredits);

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("credit_balance, is_premium, is_free_access")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: "profil_introuvable" }, { status: 500 });
  }

  const balance = profile.credit_balance ?? 0;
  const billingExempt = Boolean(profile.is_free_access || profile.is_premium);

  if (!billingExempt && creditCost > 0 && balance < creditCost) {
    return NextResponse.json(
      {
        error: balance <= 0 ? "credits_epuises" : "credits_insuffisants",
        message: "Vous n’avez plus de crédits pour utiliser l’Assistant. Rechargez votre solde pour continuer.",
        balance,
        required: creditCost,
      },
      { status: 402 },
    );
  }

  const { data: historyRows, error: histErr } = await admin
    .from("messages")
    .select("role, kind, content, metadata")
    .eq("conversation_id", body.conversationId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (histErr) {
    return NextResponse.json({ error: "historique_lecture" }, { status: 500 });
  }

  const history = (historyRows ?? []) as DbMessageRow[];
  const openaiMessages = historyToOpenAIMessages(history);
  let assistantState: Record<string, unknown> = {};
  const { data: stateRow } = await admin
    .from("conversations")
    .select("assistant_state")
    .eq("id", body.conversationId)
    .maybeSingle();
  if (
    stateRow &&
    typeof stateRow === "object" &&
    "assistant_state" in stateRow &&
    stateRow.assistant_state &&
    typeof stateRow.assistant_state === "object" &&
    !Array.isArray(stateRow.assistant_state)
  ) {
    assistantState = stateRow.assistant_state as Record<string, unknown>;
  }
  if (Object.keys(assistantState).length === 0) {
    for (const row of [...history].reverse()) {
      if (row.role !== "assistant") continue;
      const meta =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;
      const state =
        meta?.moboko_assistant_state &&
        typeof meta.moboko_assistant_state === "object" &&
        !Array.isArray(meta.moboko_assistant_state)
          ? (meta.moboko_assistant_state as Record<string, unknown>)
          : null;
      if (state) {
        assistantState = state;
        break;
      }
    }
  }

  let userContent: string | null = null;
  const userKind: "text" | "image" | "audio" = body.mode;
  let attachments: unknown[] = [];
  let media_bucket: string | null = null;
  let media_storage_path: string | null = null;
  let media_mime: string | null = null;
  let media_duration_ms: number | null = null;
  let metadataUser: Record<string, unknown> = {};
  const completionMessages: ChatCompletionMessageParam[] = [...openaiMessages];

  try {
    if (body.mode === "text") {
      const t = (body.text ?? "").trim();
      if (!t) {
        return NextResponse.json({ error: "texte_vide" }, { status: 400 });
      }
      userContent = t;
    } else if (body.mode === "image") {
      const path = body.imageStoragePath?.trim();
      if (!path || !pathBelongsToUser(path, user.id)) {
        return NextResponse.json({ error: "chemin_image_invalide" }, { status: 400 });
      }
      const mime = body.imageMime?.trim() || "image/jpeg";
      const { data: fileData, error: dlErr } = await admin.storage
        .from("chat-images")
        .download(path);
      if (dlErr || !fileData) {
        return NextResponse.json({ error: "telechargement_image" }, { status: 400 });
      }
      const buf = Buffer.from(await fileData.arrayBuffer());
      const b64 = buf.toString("base64");
      const dataUrl = `data:${mime};base64,${b64}`;
      const question = (body.text ?? "").trim() || "Que vois-tu sur cette image ? Réponds de façon utile et sobre.";
      userContent = question;
      attachments = [{ bucket: "chat-images", path, mime }];
      media_bucket = "chat-images";
      media_storage_path = path;
      media_mime = mime;
      completionMessages.push({
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      });
    } else {
      const path = body.audioStoragePath?.trim();
      if (!path || !pathBelongsToUser(path, user.id)) {
        return NextResponse.json({ error: "chemin_audio_invalide" }, { status: 400 });
      }
      const mime = body.audioMime?.trim() || "audio/webm";
      const { data: fileData, error: dlErr } = await admin.storage
        .from("chat-audio")
        .download(path);
      if (dlErr || !fileData) {
        return NextResponse.json({ error: "telechargement_audio" }, { status: 400 });
      }
      const buf = Buffer.from(await fileData.arrayBuffer());
      const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "m4a" : "audio";
      const transcription = await transcribeAudio(openai, buf, `clip.${ext}`, mime);
      if (!transcription) {
        return NextResponse.json({ error: "transcription_vide" }, { status: 422 });
      }
      userContent = transcription;
      media_duration_ms =
        body.audioDurationMs != null && Number.isFinite(body.audioDurationMs)
          ? Math.floor(body.audioDurationMs)
          : null;
      attachments = [
        {
          bucket: "chat-audio",
          path,
          mime,
          duration_ms: media_duration_ms,
        },
      ];
      media_bucket = "chat-audio";
      media_storage_path = path;
      media_mime = mime;
      metadataUser = { transcription_model: "whisper-1" };
      completionMessages.push({ role: "user", content: transcription });
    }

    let assistantText = "";
    let sermonContextCount = 0;
    let metaAssistant: Record<string, unknown> = {
      model: getChatModel(),
      sermon_context_count: 0,
    };
    let mobokoDebugChatOpenAi: Record<string, unknown> | undefined;
    let activeListId: string | null = null;

    if (body.mode === "text" && userContent) {
      const debugEnabled = process.env.MOBOKO_CHAT_OPENAI_DEBUG === "1";
      const includeBibleWithMessages = wantsBibleAndMessages(userContent);
      console.log("[moboko-openai] request_start");
      console.log("[moboko-openai] api_key_present=true");
      console.log("[moboko-openai] model=" + getChatModel());
      try {
        if (requestedMedia(userContent) === "audio") {
          const audioResults = await searchActiveSermonAudio(admin, user, userContent, 20);
          assistantText = audioResults.length > 0 ? "Sermons audio trouvés dans la base Moboko." : EMPTY_AUDIO_MESSAGE;
          metaAssistant = {
            model: getChatModel(),
            sermon_context_count: 0,
            moboko_kind: audioResults.length > 0 ? "audio_search" : "audio_search_empty",
            requested_media: "audio",
            audio_results: audioResults,
            total_count: audioResults.length,
            moboko_assistant_state: { ...assistantState, last_source: "audio", updated_at: new Date().toISOString() },
          };
          assistantState = metaAssistant.moboko_assistant_state as Record<string, unknown>;
        } else if (wantsBibleOnly(userContent)) {
          const bibleHits = await fetchBibleContext(admin, userContent);
          const bibleContext = bibleHits.map((hit) => `${hit.book} ${hit.chapter}:${hit.verse} - ${hit.text}`).join("\n");
          const bibleMessages: ChatCompletionMessageParam[] = [
            { role: "system", content: getMobokoSystemPrompt() },
            {
              role: "user",
              content:
                bibleHits.length > 0
                  ? `Question: ${userContent}\n\nReponds uniquement avec la Bible. Cite les references exactes ci-dessous, sans inventer d'autres versets.\n\n${bibleContext}`
                  : `Question: ${userContent}\n\nL'utilisateur demande la Bible, mais aucun verset exact n'a ete retrouve dans la bibliotheque locale. Dis-le simplement et propose de reformuler.`,
            },
          ];
          assistantText = bibleHits.length > 0
            ? await runChatCompletion(openai, bibleMessages)
            : "Aucun résultat biblique trouvé dans la base Moboko.";
          metaAssistant = {
            model: getChatModel(),
            sermon_context_count: 0,
            moboko_kind: "bible_context",
            bible_context_count: bibleHits.length,
            bible_sources: bibleHits.map((hit) => ({ translation: hit.translation, book: hit.book, chapter: hit.chapter, verse: hit.verse })),
            moboko_tool: "bible_context_rehydrated",
          };
          assistantState = { ...assistantState, last_source: "bible", updated_at: new Date().toISOString() };
        } else {
        const bibleHitsForMixed = includeBibleWithMessages ? await fetchBibleContext(admin, userContent) : [];
        const agent = await runOpenAiSermonAgent({
          openai,
          admin,
          conversationId: body.conversationId,
          userMessage: userContent,
          history: history.map((h) => ({ role: h.role, kind: h.kind, content: h.content })),
          state: assistantState,
          debug: debugEnabled,
        });
        sermonContextCount = agent.hits.length;
        assistantText = agent.hits.length > 0
          ? includeBibleWithMessages
            ? `${formatBibleSection(bibleHitsForMixed)}\n\nDans les Messages`
            : ""
          : includeBibleWithMessages
            ? bibleHitsForMixed.length > 0
              ? `${formatBibleSection(bibleHitsForMixed)}\n\nAucun sermon texte trouvé dans la base Moboko.`
              : "Aucun résultat trouvé dans les Messages ni dans la Bible."
            : EMPTY_CONCORDANCE_MESSAGE;
        activeListId = agent.hits.length > 0 ? crypto.randomUUID() : null;
        const listReferences =
          agent.candidateRefs && agent.candidateRefs.length > agent.hits.length
            ? agent.candidateRefs
            : agent.hits.map((h) => ({
                slug: h.slug,
                paragraph_number: h.paragraph_number,
                title: h.title,
                date: h.date,
              }));
        const listNextOffset =
          listReferences.length > agent.hits.length ? agent.hits.length : agent.nextOffset;
        const listHasMore = listReferences.length > agent.hits.length || agent.hasMore;
        const displayResults = expandConcordanceSegments(
          (await attachLinkedSermonAudio(admin, agent.hits.map((hit) => ({
            ...hit,
            _next_offset: listNextOffset,
            _has_more: listHasMore,
            _total_count: Math.max(agent.totalCount, listReferences.length),
          })), userAudioAccess.audio_streaming)) as ConcordanceHit[],
        );
        const stateWithList =
          activeListId && agent.hits.length > 0
            ? {
                ...agent.assistantState,
                current_list_id: activeListId,
                page_size: agent.pageSize,
                updated_at: new Date().toISOString(),
                result_lists: {
                  ...(((agent.assistantState as Record<string, unknown>).result_lists &&
                  typeof (agent.assistantState as Record<string, unknown>).result_lists === "object" &&
                  !Array.isArray((agent.assistantState as Record<string, unknown>).result_lists))
                    ? ((agent.assistantState as Record<string, unknown>).result_lists as Record<string, unknown>)
                    : {}),
                  [activeListId]: {
                    list_id: activeListId,
                    query: userContent,
                    scope: agent.scope,
                    relevant_count: Math.max(agent.totalCount, listReferences.length),
                    loaded_count: agent.hits.length,
                    next_offset: listNextOffset,
                    page_size: agent.pageSize,
                    references: listReferences,
                  },
                },
              }
            : { ...agent.assistantState, updated_at: new Date().toISOString() };
        metaAssistant =
          agent.hits.length > 0
            ? {
                model: getChatModel(),
                sermon_context_count: sermonContextCount,
                moboko_kind: "sermon_concordance",
                moboko_list_id: activeListId,
                results: displayResults,
                total_count: Math.max(agent.totalCount, listReferences.length),
                offset: 0,
                page_size: agent.pageSize,
                has_more: listHasMore,
                next_offset: listNextOffset,
                ...(agent.relatedAxes.length > 0 ? { moboko_suggestions: agent.relatedAxes } : {}),
                moboko_retrieval: {
                  list_id: activeListId,
                  query: userContent,
                  scope: agent.scope,
                  offset: 0,
                  page_size: agent.pageSize,
                  total_count: Math.max(agent.totalCount, listReferences.length),
                  has_more: listHasMore,
                  next_offset: listNextOffset,
                },
                moboko_assistant_state: stateWithList,
                moboko_openai_diagnostics: agent.diagnostics,
                ...(includeBibleWithMessages
                  ? {
                      bible_context_count: bibleHitsForMixed.length,
                      bible_sources: bibleHitsForMixed.map((hit) => ({
                        translation: hit.translation,
                        book: hit.book,
                        chapter: hit.chapter,
                        verse: hit.verse,
                      })),
                    }
                  : {}),
                ...(agent.noCredit ? { moboko_no_credit: true } : {}),
                moboko_tool: "responses_api_tool_loop_rehydrated",
              }
            : {
                model: getChatModel(),
                sermon_context_count: 0,
                moboko_kind: "sermon_concordance_empty",
                moboko_retrieval: {
                  query: userContent,
                  scope: agent.scope,
                  offset: 0,
                  page_size: agent.pageSize,
                  total_count: 0,
                  has_more: false,
                  next_offset: null,
                },
                moboko_assistant_state: stateWithList,
                moboko_openai_diagnostics: agent.diagnostics,
                ...(includeBibleWithMessages
                  ? {
                      bible_context_count: bibleHitsForMixed.length,
                      bible_sources: bibleHitsForMixed.map((hit) => ({
                        translation: hit.translation,
                        book: hit.book,
                        chapter: hit.chapter,
                        verse: hit.verse,
                      })),
                    }
                  : {}),
                ...(agent.noCredit ? { moboko_no_credit: true } : {}),
              };
        assistantState = stateWithList as Record<string, unknown>;
        console.log("[moboko-openai] conversation_linked=" + agent.diagnostics.conversation_linked);
        console.log("[moboko-openai] previous_response_linked=" + agent.diagnostics.previous_response_linked);
        console.log("[moboko-openai] current_message_received=true");
        console.log("[moboko-openai] history_items_count=" + agent.diagnostics.history_items_count);
        console.log("[moboko-openai] tool_calls_count=" + agent.diagnostics.tool_calls_count);
        console.log("[moboko-openai] tool_names=" + agent.diagnostics.tool_names.join(","));
        console.log("[moboko-openai] tool_outputs_returned=" + agent.diagnostics.tool_outputs_returned);
        console.log("[moboko-openai] final_selection_count=" + agent.diagnostics.final_selection_count);
        console.log("[moboko-openai] rehydrated_count=" + agent.diagnostics.rehydrated_count);
        console.log("[moboko-openai] failure_reason=" + agent.diagnostics.failure_reason);
        if (debugEnabled) {
          mobokoDebugChatOpenAi = agent.diagnostics as unknown as Record<string, unknown>;
        }
        }
      } catch (e) {
        console.error("[moboko-openai] failure_reason=assistant_unavailable", e instanceof Error ? e.message : String(e));
        return NextResponse.json(
          { error: "assistant_indisponible", detail: "L'Assistant est temporairement indisponible. Reessayez dans un instant." },
          { status: 503 },
        );
      }
    } else {
      assistantText = await runChatCompletion(openai, completionMessages);
      metaAssistant = {
        model: getChatModel(),
        sermon_context_count: 0,
      };
    }

    const hasConcordanceList =
      metaAssistant.moboko_kind === "sermon_concordance" &&
      Array.isArray(metaAssistant.results) &&
      (metaAssistant.results as unknown[]).length > 0;
    const hasConcordanceEmpty =
      metaAssistant.moboko_kind === "sermon_concordance_empty" &&
      assistantText.trim() === EMPTY_CONCORDANCE_MESSAGE;

    if (assistantText.trim().length === 0 && !hasConcordanceList && !hasConcordanceEmpty) {
      return NextResponse.json({ error: "reponse_ia_vide" }, { status: 502 });
    }

    const { data: userIns, error: uErr } = await admin
      .from("messages")
      .insert({
        conversation_id: body.conversationId,
        role: "user",
        kind: userKind,
        content: userContent,
        attachments,
        metadata: metadataUser,
        media_bucket,
        media_storage_path,
        media_mime,
        media_duration_ms,
        media_public_url: null,
      })
      .select("id")
      .single();

    if (uErr || !userIns) {
      return NextResponse.json({ error: "insertion_message_utilisateur" }, { status: 500 });
    }

    const { data: asstIns, error: aErr } = await admin
      .from("messages")
      .insert({
        conversation_id: body.conversationId,
        role: "assistant",
        kind: "text",
        content: assistantText,
        attachments: [],
        metadata: metaAssistant,
        media_bucket: null,
        media_storage_path: null,
        media_mime: null,
        media_duration_ms: null,
        media_public_url: null,
      })
      .select("id")
      .single();

    if (aErr || !asstIns) {
      return NextResponse.json({ error: "insertion_message_assistant" }, { status: 500 });
    }

    const currentTitle = typeof conv.title === "string" ? conv.title.trim() : "";
    const shouldGenerateTitle =
      body.mode === "text" &&
      Boolean(userContent?.trim()) &&
      (!currentTitle || currentTitle === "Assistant Moboko" || currentTitle === "Nouvelle discussion");
    await admin
      .from("conversations")
      .update({
        updated_at: new Date().toISOString(),
        assistant_state: assistantState,
        ...(shouldGenerateTitle && userContent ? { title: generateConversationTitle(userContent) } : {}),
      })
      .eq("id", body.conversationId);

    let balanceAfter = balance;
    let billingSkipped = billingExempt;

    const skipCreditForLocalNavigation = metaAssistant.moboko_no_credit === true;
    if (creditCost > 0 && !skipCreditForLocalNavigation) {
      const reason =
        body.mode === "text"
          ? "chat_text"
          : body.mode === "image"
            ? "chat_image"
            : "chat_voice";
      const { data: debit, error: dErr } = await admin.rpc("consume_credits_atomic", {
        p_user_id: user.id,
        p_amount: creditCost,
        p_reason: reason,
        p_ref_type: "message",
        p_ref_id: asstIns.id as string,
      });

      const debitObj = debit as {
        ok?: boolean;
        balance_after?: number;
        billing_skipped?: boolean;
      } | null;
      if (dErr || !debitObj || debitObj.ok !== true) {
        await Promise.all([
          admin.from("messages").delete().eq("id", userIns.id as string),
          admin.from("messages").delete().eq("id", asstIns.id as string),
        ]);
        return NextResponse.json(
          {
            error: "debit_credits_echoue",
            detail: debitObj ?? dErr?.message,
            messages_saved: false,
          },
          { status: 500 },
        );
      }
      billingSkipped = Boolean(debitObj.billing_skipped);
      if (typeof debitObj.balance_after === "number") {
        balanceAfter = debitObj.balance_after;
      }
    }

    const creditsDebited = billingSkipped || skipCreditForLocalNavigation ? 0 : creditCost;

    return NextResponse.json({
      ok: true,
      assistantMessageId: asstIns.id,
      userMessageId: userIns.id,
      reply: assistantText,
      credits_charged: creditsDebited,
      credit_cost: creditCost,
      balance_after: balanceAfter,
      billing_skipped: billingSkipped,
      ...(mobokoDebugChatOpenAi ? { moboko_debug_chat_openai: mobokoDebugChatOpenAi } : {}),
    });
  } catch (e) {
    console.error("[api/ai/chat]", e);
    return NextResponse.json(
      { error: "erreur_ia", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
