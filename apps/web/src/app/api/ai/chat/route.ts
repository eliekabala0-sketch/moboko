import {
  getChatModel,
  getOpenAIClient,
  historyToOpenAIMessages,
  runChatCompletion,
  transcribeAudio,
  type DbMessageRow,
} from "@/lib/ai/moboko-chat";
import { fetchSermonSearchCandidates } from "@/lib/sermons/ai-sermon-search-server";
import { coerceConcordanceHits } from "@/lib/sermons/concordance-types";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { tool_continue_last_scope } from "@/lib/chat/sermon-retrieval-tools";
import {
  ALL_PUBLIC_APP_SETTING_KEYS,
  parseAppSettingScalar,
  PUBLIC_APP_SETTING_KEYS,
} from "@moboko/shared";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  conversationId: string;
  mode: "text" | "image" | "audio" | "concordance_page";
  text?: string;
  query?: string;
  offset?: number;
  pageSize?: number;
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

const EMPTY_CONCORDANCE_MESSAGE = "Aucun paragraphe exact trouvé pour cette recherche.";

const OPENAI_CHAT_WORKFLOW_ID = "wf_69d102003c8c8190bad519a82daabdb20e38556cea1016db";
const OPENAI_RESPONSES_TEXT_MODEL = "gpt-4.1";

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

/** Agrège le texte utile depuis la réponse REST `/v1/responses` (output_text ou items output_text). */
function extractResponsesOutputText(data: unknown): string {
  if (!isRecord(data)) return "";
  const direct = data.output_text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = data.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!isRecord(c)) continue;
      if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n").trim();
}

function stripMarkdownJsonFence(s: string): string {
  let t = s.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/im.exec(t);
  if (fence?.[1]) t = fence[1].trim();
  return t;
}

/** Extrait un tableau de hits depuis la sortie texte du workflow (JSON ou { results: [] }). */
function tryParseWorkflowResultsArray(raw: string): unknown[] | null {
  const t = stripMarkdownJsonFence(raw);
  if (!t) return null;
  try {
    const v: unknown = JSON.parse(t);
    if (Array.isArray(v)) return v;
    if (isRecord(v) && Array.isArray(v.results)) return v.results;
  } catch {
    return null;
  }
  return null;
}

async function maybeInjectSermonContext(
  completionMessages: ChatCompletionMessageParam[],
  queryText: string | null,
  admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
) {
  const q = (queryText ?? "").trim();
  if (q.length < 10) return 0;
  const candidates = await fetchSermonSearchCandidates(admin, q);
  if (candidates.length === 0) return 0;
  const top = candidates.slice(0, 4);
  const clip = (text: string, max = 420) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
  };
  const lines = top.map((c, idx) => {
    const y = c.year != null ? ` (${c.year})` : "";
    return `${idx + 1}. ${c.title}${y} §${c.paragraph_number}\n${clip(c.paragraph_text, 420)}`;
  });
  completionMessages.push({
    role: "system",
    content:
      "Contexte sermons disponibles (extraits vérifiés de la base Moboko ; n'invente pas au-delà) :\n\n" +
      lines.join("\n\n"),
  });
  return top.length;
}

export async function POST(request: Request) {
  const openai = getOpenAIClient();
  if (!openai) {
    return NextResponse.json(
      { error: "openai_non_configure", detail: "OPENAI_API_KEY manquante côté serveur." },
      { status: 503 },
    );
  }

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
    .select("id, user_id")
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
    for (const r of recent ?? []) {
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
    const result = await tool_continue_last_scope(admin, {
      last_scope:
        lastScope && typeof lastScope === "object" && !Array.isArray(lastScope) && (lastScope as Record<string, unknown>).kind === "sermon"
          ? { kind: "sermon", sermon_slug: String((lastScope as Record<string, unknown>).sermon_slug ?? "").trim() }
          : { kind: "library" },
      last_query: lastQuery ?? query,
      next_offset: offset,
      page_size: pageSize,
      conversation_id: body.conversationId,
    });
    return NextResponse.json({
      ok: true,
      results: result.results,
      total_count: result.total_count,
      offset: result.offset,
      page_size: result.page_size,
      has_more: result.has_more,
      next_offset: result.next_offset,
      message: result.total_count === 0 ? EMPTY_CONCORDANCE_MESSAGE : null,
    });
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
        error: "credits_insuffisants",
        message: `Il vous faut ${creditCost} crédit(s) pour cette action (solde : ${balance}).`,
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

    if (body.mode === "text" && userContent) {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        return NextResponse.json(
          { error: "openai_non_configure", detail: "OPENAI_API_KEY manquante côté serveur." },
          { status: 503 },
        );
      }
      try {
        const res = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: OPENAI_RESPONSES_TEXT_MODEL,
            input: userContent,
            workflow: OPENAI_CHAT_WORKFLOW_ID,
          }),
        });
        const data: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error("[api/ai/chat] openai responses", res.status, data);
          assistantText = EMPTY_CONCORDANCE_MESSAGE;
          metaAssistant = {
            model: OPENAI_RESPONSES_TEXT_MODEL,
            sermon_context_count: 0,
            moboko_kind: "sermon_concordance_empty",
            moboko_retrieval: {
              query: userContent,
              scope: { kind: "library" },
              offset: 0,
              page_size: CONCORDANCE_PAGE_SIZE,
              total_count: 0,
              has_more: false,
              next_offset: null,
            },
          };
        } else {
          const outputText = extractResponsesOutputText(data);
          if (!outputText) {
            assistantText = EMPTY_CONCORDANCE_MESSAGE;
            metaAssistant = {
              model: OPENAI_RESPONSES_TEXT_MODEL,
              sermon_context_count: 0,
              moboko_kind: "sermon_concordance_empty",
              moboko_retrieval: {
                query: userContent,
                scope: { kind: "library" },
                offset: 0,
                page_size: CONCORDANCE_PAGE_SIZE,
                total_count: 0,
                has_more: false,
                next_offset: null,
              },
            };
          } else {
            const rawResults = tryParseWorkflowResultsArray(outputText);
            const hits = rawResults ? coerceConcordanceHits(rawResults) : [];
            if (hits.length === 0) {
              assistantText = EMPTY_CONCORDANCE_MESSAGE;
              metaAssistant = {
                model: OPENAI_RESPONSES_TEXT_MODEL,
                sermon_context_count: 0,
                moboko_kind: "sermon_concordance_empty",
                moboko_retrieval: {
                  query: userContent,
                  scope: { kind: "library" },
                  offset: 0,
                  page_size: CONCORDANCE_PAGE_SIZE,
                  total_count: 0,
                  has_more: false,
                  next_offset: null,
                },
              };
            } else {
              const enriched = hits.map((h) => ({
                ...h,
                _source: "chat" as const,
                _query: userContent,
                _conversation_id: body.conversationId,
              }));
              sermonContextCount = enriched.length;
              assistantText = "";
              const total_count =
                typeof enriched[0]?._total_count === "number" ? enriched[0]._total_count : enriched.length;
              const offset = typeof enriched[0]?._offset === "number" ? enriched[0]._offset : 0;
              const page_size =
                typeof enriched[0]?._page_size === "number" ? enriched[0]._page_size : CONCORDANCE_PAGE_SIZE;
              const has_more =
                typeof enriched[0]?._has_more === "boolean" ? enriched[0]._has_more : false;
              const next_offset =
                enriched[0]?._next_offset === null || typeof enriched[0]?._next_offset === "number"
                  ? enriched[0]._next_offset
                  : null;
              const scope =
                enriched.length > 0 && enriched.every((h) => h.slug === enriched[0]!.slug)
                  ? { kind: "sermon" as const, sermon_slug: enriched[0]!.slug }
                  : { kind: "library" as const };
              metaAssistant = {
                model: OPENAI_RESPONSES_TEXT_MODEL,
                sermon_context_count: sermonContextCount,
                moboko_kind: "sermon_concordance",
                results: enriched,
                total_count,
                offset,
                page_size,
                has_more,
                next_offset,
                moboko_retrieval: {
                  query: userContent,
                  scope,
                  offset,
                  page_size,
                  total_count,
                  has_more,
                  next_offset,
                },
                moboko_tool: "openai_responses_workflow",
              };
            }
          }
        }
      } catch (e) {
        console.error("[api/ai/chat] openai workflow", e);
        assistantText = EMPTY_CONCORDANCE_MESSAGE;
        metaAssistant = {
          model: OPENAI_RESPONSES_TEXT_MODEL,
          sermon_context_count: 0,
          moboko_kind: "sermon_concordance_empty",
        };
      }
    } else {
      sermonContextCount = await maybeInjectSermonContext(
        completionMessages,
        userContent,
        admin,
      );
      assistantText = await runChatCompletion(openai, completionMessages);
      metaAssistant = {
        model: getChatModel(),
        sermon_context_count: sermonContextCount,
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

    await admin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", body.conversationId);

    let balanceAfter = balance;
    let billingSkipped = billingExempt;

    if (creditCost > 0) {
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
        return NextResponse.json(
          {
            error: "debit_credits_echoue",
            detail: debitObj ?? dErr?.message,
            messages_saved: true,
          },
          { status: 500 },
        );
      }
      billingSkipped = Boolean(debitObj.billing_skipped);
      if (typeof debitObj.balance_after === "number") {
        balanceAfter = debitObj.balance_after;
      }
    }

    const creditsDebited = billingSkipped ? 0 : creditCost;

    return NextResponse.json({
      ok: true,
      assistantMessageId: asstIns.id,
      userMessageId: userIns.id,
      reply: assistantText,
      credits_charged: creditsDebited,
      credit_cost: creditCost,
      balance_after: balanceAfter,
      billing_skipped: billingSkipped,
    });
  } catch (e) {
    console.error("[api/ai/chat]", e);
    return NextResponse.json(
      { error: "erreur_ia", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
