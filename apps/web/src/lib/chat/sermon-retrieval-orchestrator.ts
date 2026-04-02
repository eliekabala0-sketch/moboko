import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbMessageRow } from "@/lib/ai/moboko-chat";
import type { LastRetrievalState, RetrievalOrchestratorResult, RetrievalScope } from "@/lib/chat/sermon-retrieval-types";
import {
  tool_continue_last_scope,
  tool_get_neighbor_paragraphs,
  tool_get_paragraph_by_number,
  tool_search_paragraphs_global,
  tool_search_paragraphs_in_sermon,
} from "@/lib/chat/sermon-retrieval-tools";

function extractLastRetrievalState(history: DbMessageRow[]): LastRetrievalState | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (r.role !== "assistant") continue;
    const meta =
      r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata)
        ? (r.metadata as Record<string, unknown>)
        : null;
    if (!meta) continue;
    if (meta.moboko_kind !== "sermon_concordance") continue;
    const last = meta.moboko_retrieval;
    if (!last || typeof last !== "object" || Array.isArray(last)) continue;
    const o = last as Record<string, unknown>;
    const query = typeof o.query === "string" ? o.query : "";
    const scopeRaw = o.scope;
    const scope: RetrievalScope =
      scopeRaw && typeof scopeRaw === "object" && !Array.isArray(scopeRaw) && (scopeRaw as Record<string, unknown>).kind === "sermon"
        ? {
            kind: "sermon",
            sermon_slug: String((scopeRaw as Record<string, unknown>).sermon_slug ?? "").trim(),
          }
        : { kind: "library" };
    const offset = typeof o.offset === "number" ? o.offset : 0;
    const page_size = typeof o.page_size === "number" ? o.page_size : 20;
    const total_count = typeof o.total_count === "number" ? o.total_count : 0;
    const next_offset = typeof o.next_offset === "number" ? o.next_offset : o.next_offset === null ? null : null;
    const has_more = typeof o.has_more === "boolean" ? o.has_more : false;
    if (!query.trim()) continue;
    if (scope.kind === "sermon" && !scope.sermon_slug) continue;
    return {
      query: query.trim(),
      scope,
      offset: Math.max(0, Math.floor(offset)),
      page_size: Math.max(1, Math.min(50, Math.floor(page_size))),
      total_count: Math.max(0, Math.floor(total_count)),
      next_offset: next_offset == null ? null : Math.max(0, Math.floor(next_offset)),
      has_more,
    };
  }
  return null;
}

export function buildRetrievalMetadata(result: RetrievalOrchestratorResult, query: string) {
  return {
    moboko_kind: "sermon_concordance",
    results: result.results,
    total_count: result.total_count,
    offset: result.offset,
    page_size: result.page_size,
    has_more: result.has_more,
    next_offset: result.next_offset,
    moboko_retrieval: {
      query,
      scope: result.scope,
      offset: result.offset,
      page_size: result.page_size,
      total_count: result.total_count,
      has_more: result.has_more,
      next_offset: result.next_offset,
    },
  } as const;
}

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

function asOptionalInt(x: unknown): number | undefined {
  const n = asInt(x);
  return n == null ? undefined : n;
}

function hasExplicitContinuityCue(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("dans ce sermon") ||
    q.includes("ce sermon") ||
    q.includes("tu as bien le sermon") ||
    q.includes("encore") ||
    q.includes("plus loin") ||
    q.includes("ce passage") ||
    q.includes("cette fille")
  );
}

/** Titre de sermon explicitement cité après « dans le sermon … », pour résolution canonique (cas 1). */
function extractExplicitSermonTitleFromUserQuery(query: string): string | null {
  const m = query.match(/dans le sermon\s+(.+?)\s*,\s*/i);
  const g = m?.[1]?.trim();
  return g && g.length >= 12 ? g : null;
}

function toolArgsErrorResult(pageSize: number): RetrievalOrchestratorResult {
  return {
    ok: true,
    results: [],
    total_count: 0,
    scope: { kind: "library" },
    next_offset: null,
    offset: 0,
    page_size: pageSize,
    has_more: false,
  };
}

function isRetrievalOrchestratorResult(x: unknown): x is RetrievalOrchestratorResult {
  if (!isRecord(x)) return false;
  if (x.ok !== true) return false;
  if (!Array.isArray(x.results)) return false;
  if (typeof x.total_count !== "number") return false;
  if (!isRecord(x.scope) || typeof x.scope.kind !== "string") return false;
  if (typeof x.offset !== "number") return false;
  if (typeof x.page_size !== "number") return false;
  if (typeof x.has_more !== "boolean") return false;
  if (!(typeof x.next_offset === "number" || x.next_offset === null)) return false;
  return true;
}

export async function runSermonRetrievalOrchestrator(opts: {
  openai: OpenAI;
  admin: SupabaseClient;
  conversationId: string;
  userQuery: string;
  history: DbMessageRow[];
  pageSize: number;
}): Promise<{ result: RetrievalOrchestratorResult; usedTool: string; lastState: LastRetrievalState | null }> {
  const q = opts.userQuery.trim();
  const last = extractLastRetrievalState(opts.history);
  const activeSermonSlug = last?.scope.kind === "sermon" ? last.scope.sermon_slug : null;
  // Intention produit: éviter tout pré-routage local du chat avant l’IA.
  // Le modèle reçoit la requête brute et décide seul des tool-calls.

  const system = [
    "Tu es l’orchestrateur retrieval de Moboko.",
    "Tu ne réponds jamais par du texte libre. Tu DOIS appeler exactement 1 outil.",
    "Tu dois appeler un outil qui retourne des résultats exploitables par l'application.",
    "N'appelle jamais un outil de simple résolution: appelle directement un outil qui retourne des paragraphes.",
    "N'utilise le dernier scope (sermon précédent) QUE si l'utilisateur exprime explicitement une continuité (ex: 'encore', 'plus loin', 'dans ce sermon', 'cette fille', 'ce passage').",
    "Si la nouvelle requête introduit un autre sujet sans continuité explicite, utilise search_paragraphs_global.",
    "Si l'utilisateur demande 'juste le paragraphe' ou une seule occurrence, utilise page_size=1 (et continue_last_scope si c'est une continuation).",
    "Le résultat de l’outil est directement renvoyé à l’application (JSON).",
    "Choisis l’outil le plus adapté :",
    "- get_paragraph_by_number: si l’utilisateur demande un § précis dans un sermon",
    "- search_paragraphs_in_sermon: si l’utilisateur veut chercher dans un sermon donné",
    "- search_paragraphs_global: recherche bibliothèque",
    "- continue_last_scope: si l’utilisateur demande une suite (encore, plus loin, etc.) et qu’un dernier scope existe",
    "",
    "Contexte immédiat: aucun pré-routage local imposé.",
  ].join("\n");

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "get_paragraph_by_number",
        description: "Récupère un paragraphe exact (§n) dans un sermon (slug) + voisins, format concordance.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sermon_slug: { type: "string" },
            title_or_slug: { type: "string" },
            paragraph_number: { type: "integer" },
            query: { type: "string" },
            conversation_id: { type: "string" },
          },
          required: ["paragraph_number", "query", "conversation_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "search_paragraphs_in_sermon",
        description: "Recherche des paragraphes dans un sermon (slug), pagination par offset.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sermon_slug: { type: "string" },
            title_or_slug: { type: "string" },
            query: { type: "string" },
            offset: { type: "integer" },
            page_size: { type: "integer" },
            conversation_id: { type: "string" },
          },
          required: ["query", "conversation_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "search_paragraphs_global",
        description: "Recherche des paragraphes dans toute la bibliothèque, pagination par offset.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" },
            offset: { type: "integer" },
            page_size: { type: "integer" },
            conversation_id: { type: "string" },
          },
          required: ["query", "conversation_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_neighbor_paragraphs",
        description: "Récupère §(n-1) et §(n+1) pour un sermon publié.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sermon_slug: { type: "string" },
            paragraph_number: { type: "integer" },
          },
          required: ["sermon_slug", "paragraph_number"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "continue_last_scope",
        description: "Suite d’une recherche précédente (même scope), en repartant de next_offset.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            last_scope: { type: "object" },
            last_query: { type: "string" },
            next_offset: { type: "integer" },
            page_size: { type: "integer" },
            conversation_id: { type: "string" },
          },
          required: ["last_scope", "last_query", "next_offset", "conversation_id"],
        },
      },
    },
  ];

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: q },
  ];
  console.log("[chat-orchestrator] openai_request_query", { query: q });
  console.log("[chat-orchestrator] openai_request_messages", JSON.stringify(messages));

  const completion = await opts.openai.chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini",
    messages,
    tools,
    tool_choice: "required",
    temperature: 0.1,
    max_tokens: 700,
  });
  console.log("[chat-orchestrator] openai_completion_raw", JSON.stringify(completion));

  const msg = completion.choices[0]?.message;
  const toolCalls = msg?.tool_calls ?? [];
  console.log("[chat-orchestrator] tool_call_presence", { hasToolCall: toolCalls.length > 0, count: toolCalls.length });
  const first = toolCalls[0];
  if (!first || first.type !== "function") {
    return { result: toolArgsErrorResult(opts.pageSize), usedTool: "tool_call_missing", lastState: last };
  }

  const name = first.function.name;
  const rawArgs = first.function.arguments || "{}";
  let parsedArgs: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(rawArgs);
    parsedArgs = isRecord(v) ? v : {};
  } catch {
    parsedArgs = {};
  }
  console.log("[chat-orchestrator] tool_call_selected", { tool: name, rawArgs, parsedArgs });

  // Injecte les paramètres “obligatoires” utiles quand l’outil les supporte.
  if (name === "search_paragraphs_global" || name === "search_paragraphs_in_sermon") {
    parsedArgs.page_size = typeof parsedArgs.page_size === "number" ? parsedArgs.page_size : opts.pageSize;
    parsedArgs.offset = typeof parsedArgs.offset === "number" ? parsedArgs.offset : 0;
  }
  if (name === "get_paragraph_by_number") {
    parsedArgs.query = typeof parsedArgs.query === "string" ? parsedArgs.query : q;
  }

  // “continue_last_scope” nécessite le dernier état, sinon on dégrade vers recherche globale.
  if (name === "continue_last_scope") {
    if (!last || last.next_offset == null) {
      return { result: toolArgsErrorResult(opts.pageSize), usedTool: "tool_args_invalid:continue_last_scope_missing_last_scope", lastState: last };
    }
    parsedArgs.last_scope = parsedArgs.last_scope ?? last.scope;
    parsedArgs.last_query = typeof parsedArgs.last_query === "string" ? parsedArgs.last_query : last.query;
    parsedArgs.next_offset = typeof parsedArgs.next_offset === "number" ? parsedArgs.next_offset : last.next_offset;
    parsedArgs.page_size = typeof parsedArgs.page_size === "number" ? parsedArgs.page_size : opts.pageSize;
    parsedArgs.conversation_id = opts.conversationId;
  } else if (name === "search_paragraphs_global" || name === "search_paragraphs_in_sermon" || name === "get_paragraph_by_number") {
    parsedArgs.conversation_id = opts.conversationId;
  }

  let toolResult: unknown;
  try {
    switch (name) {
      case "get_paragraph_by_number": {
        const sermon_slug = asTrimmedString(parsedArgs.sermon_slug);
        const title_or_slug = asTrimmedString(parsedArgs.title_or_slug);
        const paragraph_number = asInt(parsedArgs.paragraph_number);
        const queryArg = asTrimmedString(parsedArgs.query) ?? q;
        const conversation_id = asTrimmedString(parsedArgs.conversation_id) ?? opts.conversationId;
        const stickySermonSlug =
          last?.scope.kind === "sermon" &&
          hasExplicitContinuityCue(q)
            ? last.scope.sermon_slug
            : undefined;
        if ((!sermon_slug && !title_or_slug && !stickySermonSlug) || paragraph_number == null || !conversation_id) {
          return { result: toolArgsErrorResult(opts.pageSize), usedTool: "tool_args_invalid:get_paragraph_by_number", lastState: last };
        }
        const lockActive = Boolean(stickySermonSlug);
        if (lockActive) {
          console.log("[chat-orchestrator] continuity_scope_reuse", {
            active_sermon_slug: stickySermonSlug,
            lock_sermon_slug: true,
            user_query: q,
            ignored_title_or_slug: title_or_slug ?? null,
            ignored_model_sermon_slug: sermon_slug ?? null,
          });
        }
        toolResult = await tool_get_paragraph_by_number(opts.admin, {
          sermon_slug: stickySermonSlug ?? sermon_slug ?? undefined,
          title_or_slug: lockActive ? undefined : title_or_slug ?? undefined,
          paragraph_number,
          query: queryArg,
          conversation_id,
          lock_sermon_slug: lockActive,
          preferred_sermon_slug: lockActive ? undefined : activeSermonSlug,
        });
        break;
      }
      case "search_paragraphs_in_sermon": {
        let sermon_slug = asTrimmedString(parsedArgs.sermon_slug);
        let title_or_slug = asTrimmedString(parsedArgs.title_or_slug);
        const queryStr = asTrimmedString(parsedArgs.query);
        const conversation_id = asTrimmedString(parsedArgs.conversation_id) ?? opts.conversationId;
        const extractedSermonTitle = extractExplicitSermonTitleFromUserQuery(q);
        if (extractedSermonTitle && (!title_or_slug || extractedSermonTitle.length > title_or_slug.length)) {
          title_or_slug = extractedSermonTitle;
        }
        const forceActiveScope =
          Boolean(activeSermonSlug) && hasExplicitContinuityCue(q) && !extractedSermonTitle;
        if (forceActiveScope) {
          sermon_slug = activeSermonSlug;
          title_or_slug = null;
          console.log("[chat-orchestrator] continuity_force_sermon_scope_search", {
            active_sermon_slug: activeSermonSlug,
            user_query: q,
          });
        }
        if ((!sermon_slug && !title_or_slug) || !queryStr || !conversation_id) {
          return { result: toolArgsErrorResult(opts.pageSize), usedTool: "tool_args_invalid:search_paragraphs_in_sermon", lastState: last };
        }
        const preferredForSearch = extractedSermonTitle ? undefined : activeSermonSlug ?? undefined;
        toolResult = await tool_search_paragraphs_in_sermon(opts.admin, {
          sermon_slug: sermon_slug ?? undefined,
          title_or_slug: title_or_slug ?? undefined,
          query: queryStr,
          offset: asOptionalInt(parsedArgs.offset),
          page_size: asOptionalInt(parsedArgs.page_size),
          conversation_id,
          lock_sermon_slug: forceActiveScope,
          preferred_sermon_slug: forceActiveScope ? undefined : preferredForSearch,
        });
        break;
      }
      case "search_paragraphs_global": {
        const queryStr = asTrimmedString(parsedArgs.query);
        const conversation_id = asTrimmedString(parsedArgs.conversation_id) ?? opts.conversationId;
        if (!queryStr || !conversation_id) {
          return { result: toolArgsErrorResult(opts.pageSize), usedTool: "tool_args_invalid:search_paragraphs_global", lastState: last };
        }
        toolResult = await tool_search_paragraphs_global(opts.admin, {
          query: queryStr,
          offset: asOptionalInt(parsedArgs.offset),
          page_size: asOptionalInt(parsedArgs.page_size),
          conversation_id,
        });
        break;
      }
      case "get_neighbor_paragraphs": {
        const sermon_slug = asTrimmedString(parsedArgs.sermon_slug);
        const paragraph_number = asInt(parsedArgs.paragraph_number);
        if (!sermon_slug || paragraph_number == null) {
          return { result: toolArgsErrorResult(opts.pageSize), usedTool: "tool_args_invalid:get_neighbor_paragraphs", lastState: last };
        }
        toolResult = await tool_get_neighbor_paragraphs(opts.admin, { sermon_slug, paragraph_number });
        break;
      }
      case "continue_last_scope": {
        const last_scope = parsedArgs.last_scope;
        const last_query = asTrimmedString(parsedArgs.last_query);
        const next_offset = asInt(parsedArgs.next_offset);
        const conversation_id = asTrimmedString(parsedArgs.conversation_id) ?? opts.conversationId;
        if (!last_query || next_offset == null || !conversation_id) {
          return { result: toolArgsErrorResult(opts.pageSize), usedTool: "tool_args_invalid:continue_last_scope", lastState: last };
        }
        toolResult = await tool_continue_last_scope(opts.admin, {
          last_scope: isRecord(last_scope) && last_scope.kind === "sermon"
            ? { kind: "sermon", sermon_slug: String(last_scope.sermon_slug ?? "").trim() }
            : { kind: "library" },
          last_query,
          next_offset,
          page_size: asOptionalInt(parsedArgs.page_size),
          conversation_id,
        });
        break;
      }
      default: {
        return { result: toolArgsErrorResult(opts.pageSize), usedTool: "tool_unknown", lastState: last };
      }
    }
  } catch {
    // Erreur contrôlée côté orchestrateur.
    return {
      result: toolArgsErrorResult(opts.pageSize),
      usedTool: `tool_dispatch_error:${name}`,
      lastState: last,
    };
  }
  console.log("[chat-orchestrator] tool_result", {
    tool: name,
    resultSummary: isRecord(toolResult)
      ? {
          ok: toolResult.ok,
          total_count: toolResult.total_count,
          has_results: Array.isArray(toolResult.results) && toolResult.results.length > 0,
          first_result: Array.isArray(toolResult.results) && toolResult.results.length > 0 ? toolResult.results[0] : null,
        }
      : toolResult,
  });

  // Si l’outil ne renvoie pas déjà le format attendu, on convertit en réponse vide.
  const normalized: RetrievalOrchestratorResult = isRetrievalOrchestratorResult(toolResult)
    ? toolResult
    : {
        ok: true,
        results: [],
        total_count: 0,
        scope: { kind: "library" },
        next_offset: null,
        offset: 0,
        page_size: opts.pageSize,
        has_more: false,
      };

  return { result: normalized, usedTool: name, lastState: last };
}

