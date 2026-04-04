import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetrievalOrchestratorResult, RetrievalScope } from "@/lib/chat/sermon-retrieval-types";
import {
  tool_continue_last_scope,
  tool_find_sermon_by_title_or_slug,
  tool_get_paragraph_by_number,
  tool_search_paragraphs_global,
  tool_search_paragraphs_in_sermon,
} from "@/lib/chat/sermon-retrieval-tools";

const DEFAULT_PAGE = 20;

export type SermonToolContext = {
  /** Pour champs _conversation_id sur les hits (chat = id réel). */
  conversationId?: string;
};

export type SermonToolSuccessEnvelope = {
  ok: true;
  results: unknown[];
  total_count: number;
  offset: number;
  page_size: number;
  has_more: boolean;
  next_offset: number | null;
  scope: RetrievalScope;
  sermon_slug?: string | null;
  sermon_title?: string | null;
};

export type SermonToolErrorEnvelope = {
  ok: false;
  error: string;
  results: [];
  total_count: 0;
  offset: 0;
  page_size: number;
  has_more: false;
  next_offset: null;
  scope: RetrievalScope;
};

export type SermonToolEnvelope = SermonToolSuccessEnvelope | SermonToolErrorEnvelope;

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function asTrimmedString(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t ? t : null;
}

function asInt(x: unknown): number | null {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (!Number.isInteger(x)) return null;
  return x;
}

function toSuccess(r: RetrievalOrchestratorResult): SermonToolSuccessEnvelope {
  return {
    ok: true,
    results: r.results,
    total_count: r.total_count,
    offset: r.offset,
    page_size: r.page_size,
    has_more: r.has_more,
    next_offset: r.next_offset,
    scope: r.scope,
  };
}

function err(
  message: string,
  pageSize = DEFAULT_PAGE,
): SermonToolErrorEnvelope {
  return {
    ok: false,
    error: message,
    results: [],
    total_count: 0,
    offset: 0,
    page_size: pageSize,
    has_more: false,
    next_offset: null,
    scope: { kind: "library" },
  };
}

export async function handleFindSermon(
  admin: SupabaseClient,
  raw: unknown,
): Promise<SermonToolEnvelope> {
  if (!isRecord(raw)) return err("corps_invalide");
  const title_or_slug = asTrimmedString(raw.title_or_slug);
  if (!title_or_slug) return err("title_or_slug_requis");
  const r = await tool_find_sermon_by_title_or_slug(admin, { title_or_slug });
  return {
    ok: true,
    results: [],
    total_count: 0,
    offset: 0,
    page_size: DEFAULT_PAGE,
    has_more: false,
    next_offset: null,
    scope: r.scope,
    sermon_slug: r.sermon_slug,
    sermon_title: r.sermon_title,
  };
}

export async function handleGetParagraph(
  admin: SupabaseClient,
  raw: unknown,
  ctx: SermonToolContext,
): Promise<SermonToolEnvelope> {
  if (!isRecord(raw)) return err("corps_invalide");
  const sermon_slug = asTrimmedString(raw.sermon_slug);
  const paragraph_number = asInt(raw.paragraph_number);
  if (!sermon_slug || paragraph_number == null || paragraph_number < 1) {
    return err("sermon_slug_et_paragraph_number_requis");
  }
  const conversationId = asTrimmedString(raw.conversation_id) ?? ctx.conversationId ?? "api-tools";
  const r = await tool_get_paragraph_by_number(admin, {
    sermon_slug,
    paragraph_number,
    query: "",
    conversation_id: conversationId,
  });
  return toSuccess(r);
}

export async function handleSearchInSermon(
  admin: SupabaseClient,
  raw: unknown,
  ctx: SermonToolContext,
): Promise<SermonToolEnvelope> {
  if (!isRecord(raw)) return err("corps_invalide");
  const sermon_slug = asTrimmedString(raw.sermon_slug);
  const query = asTrimmedString(raw.query);
  if (!sermon_slug || !query) return err("sermon_slug_et_query_requis");
  const offset = asInt(raw.offset) ?? 0;
  const page_size = Math.max(1, Math.min(50, asInt(raw.page_size) ?? DEFAULT_PAGE));
  const conversationId = asTrimmedString(raw.conversation_id) ?? ctx.conversationId ?? "api-tools";
  const r = await tool_search_paragraphs_in_sermon(admin, {
    sermon_slug,
    query,
    offset: Math.max(0, offset),
    page_size,
    conversation_id: conversationId,
  });
  return toSuccess(r);
}

export async function handleSearchGlobal(
  admin: SupabaseClient,
  raw: unknown,
  ctx: SermonToolContext,
): Promise<SermonToolEnvelope> {
  if (!isRecord(raw)) return err("corps_invalide");
  const query = asTrimmedString(raw.query);
  if (!query) return err("query_requis");
  const offset = asInt(raw.offset) ?? 0;
  const page_size = Math.max(1, Math.min(50, asInt(raw.page_size) ?? DEFAULT_PAGE));
  const conversationId = asTrimmedString(raw.conversation_id) ?? ctx.conversationId ?? "api-tools";
  const r = await tool_search_paragraphs_global(admin, {
    query,
    offset: Math.max(0, offset),
    page_size,
    conversation_id: conversationId,
  });
  return toSuccess(r);
}

/** Dernier scope/query concordance (assistant), même logique que pagination chat. */
export async function getLastConcordanceRetrieval(
  admin: SupabaseClient,
  conversationId: string,
): Promise<{ query: string; scope: RetrievalScope } | null> {
  const { data: recent } = await admin
    .from("messages")
    .select("role, metadata")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(30);

  for (const row of recent ?? []) {
    const r = row as { role?: string; metadata?: unknown };
    if (r.role !== "assistant") continue;
    const meta =
      r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata)
        ? (r.metadata as Record<string, unknown>)
        : null;
    if (!meta || meta.moboko_kind !== "sermon_concordance") continue;
    const last =
      meta.moboko_retrieval && typeof meta.moboko_retrieval === "object" && !Array.isArray(meta.moboko_retrieval)
        ? (meta.moboko_retrieval as Record<string, unknown>)
        : null;
    if (!last) continue;
    const q = typeof last.query === "string" ? last.query.trim() : "";
    const sc = last.scope;
    if (!q) continue;
    const scope: RetrievalScope =
      sc && typeof sc === "object" && !Array.isArray(sc) && (sc as Record<string, unknown>).kind === "sermon"
        ? {
            kind: "sermon",
            sermon_slug: String((sc as Record<string, unknown>).sermon_slug ?? "").trim(),
          }
        : { kind: "library" };
    if (scope.kind === "sermon" && !scope.sermon_slug) continue;
    return { query: q, scope };
  }
  return null;
}

export async function handleContinueScope(
  admin: SupabaseClient,
  raw: unknown,
  ctx: SermonToolContext,
): Promise<SermonToolEnvelope> {
  if (!isRecord(raw)) return err("corps_invalide");
  const conversation_id = asTrimmedString(raw.conversation_id) ?? ctx.conversationId;
  if (!conversation_id) return err("conversation_id_requis");
  const offset = Math.max(0, asInt(raw.offset) ?? 0);
  const page_size = Math.max(1, Math.min(50, asInt(raw.page_size) ?? DEFAULT_PAGE));

  const last = await getLastConcordanceRetrieval(admin, conversation_id);
  if (!last) {
    return {
      ok: true,
      results: [],
      total_count: 0,
      offset,
      page_size,
      has_more: false,
      next_offset: null,
      scope: { kind: "library" },
    };
  }

  const r = await tool_continue_last_scope(admin, {
    last_scope: last.scope,
    last_query: last.query,
    next_offset: offset,
    page_size,
    conversation_id,
  });
  return toSuccess(r);
}

export async function dispatchSermonToolByName(
  admin: SupabaseClient,
  name: string,
  argsJson: string,
  ctx: SermonToolContext,
): Promise<SermonToolEnvelope> {
  let args: unknown = {};
  try {
    args = argsJson.trim() ? JSON.parse(argsJson) : {};
  } catch {
    return err("arguments_json_invalides");
  }
  switch (name) {
    case "find_sermon":
      return handleFindSermon(admin, args);
    case "get_paragraph":
      return handleGetParagraph(admin, args, ctx);
    case "search_in_sermon":
      return handleSearchInSermon(admin, args, ctx);
    case "search_global":
      return handleSearchGlobal(admin, args, ctx);
    case "continue_scope":
      return handleContinueScope(admin, args, ctx);
    default:
      return err(`outil_inconnu:${name}`);
  }
}
