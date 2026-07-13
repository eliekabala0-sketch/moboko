import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConcordanceHit } from "@/lib/sermons/concordance-types";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { fetchSingleParagraphCandidate } from "@/lib/sermons/retrieval-direct";
import {
  tool_continue_last_scope,
  tool_find_sermon_by_title_or_slug,
  tool_get_neighbor_paragraphs,
  tool_get_paragraph_by_number,
  tool_search_paragraphs_global,
  tool_search_paragraphs_in_sermon,
} from "@/lib/chat/sermon-retrieval-tools";
import type { RetrievalScope } from "@/lib/chat/sermon-retrieval-types";
import { getChatModel } from "@/lib/ai/moboko-chat";

type JsonRecord = Record<string, unknown>;

type ConversationAssistantState = {
  last_openai_response_id?: string | null;
  active_topic?: string | null;
  active_scope?: RetrievalScope;
  active_sermon_slug?: string | null;
  active_result_refs?: Array<{ slug: string; paragraph_number: number; title?: string; date?: string | null }>;
  active_result_index?: number | null;
  filters?: JsonRecord;
  sort?: "chronological_asc" | "relevance";
  last_query?: string | null;
  last_search_plan?: JsonRecord | string | null;
  last_total_count?: number | null;
  next_offset?: number | null;
  related_axes?: string[];
};

type AgentToolResult = {
  ok: boolean;
  results?: ConcordanceHit[];
  total_count?: number;
  offset?: number;
  page_size?: number;
  has_more?: boolean;
  next_offset?: number | null;
  scope?: RetrievalScope;
  error_code?: string | null;
};

export type OpenAiSermonAgentResult = {
  text: string;
  hits: ConcordanceHit[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number | null;
  pageSize: number;
  scope: RetrievalScope;
  relatedAxes: string[];
  assistantState: ConversationAssistantState;
  noCredit?: boolean;
  diagnostics: {
    openai_calls: number;
    tool_calls_count: number;
    tool_names: string[];
    tool_outputs_returned: boolean;
    final_selection_count: number;
    rehydrated_count: number;
    previous_response_linked: boolean;
    conversation_linked: boolean;
    history_items_count: number;
    failure_reason: string | null;
  };
};

const EMPTY_MESSAGE = "Aucun passage suffisamment précis n'a été trouvé pour cette formulation.";
const MAX_TOOL_ROUNDS = 5;
const MAX_TOOL_RESULTS_FOR_MODEL = 16;
const DEFAULT_PAGE_SIZE = 16;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeText(text: string, max = 420) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function summarizeHit(hit: ConcordanceHit) {
  return {
    slug: hit.slug,
    title: hit.title,
    date: hit.date,
    location: hit.location,
    paragraph_number: hit.paragraph_number,
    excerpt: sanitizeText(hit.paragraph_text),
  };
}

function summarizeToolResult(result: AgentToolResult): JsonRecord {
  return {
    ok: result.ok,
    results: (result.results ?? []).slice(0, MAX_TOOL_RESULTS_FOR_MODEL).map(summarizeHit),
    total_count: result.total_count ?? 0,
    offset: result.offset ?? 0,
    page_size: result.page_size ?? DEFAULT_PAGE_SIZE,
    has_more: Boolean(result.has_more),
    next_offset: result.next_offset ?? null,
    scope: result.scope ?? { kind: "library" },
    error_code: result.error_code ?? null,
  };
}

function compactHistory(history: Array<{ role: string; kind: string; content: string | null }>) {
  return history
    .slice(-10)
    .map((m) => ({
      role: m.role,
      kind: m.kind,
      content: sanitizeText(m.content ?? "", 260),
    }))
    .filter((m) => m.content);
}

function extractOutputText(response: JsonRecord): string {
  const direct = response.output_text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = response.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (typeof item.output_text === "string") parts.push(item.output_text);
    if (typeof item.text === "string") parts.push(item.text);
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (isRecord(c) && c.type === "output_text" && typeof c.text === "string") {
        parts.push(c.text);
      } else if (isRecord(c) && typeof c.text === "string") {
        parts.push(c.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractFunctionCalls(response: JsonRecord) {
  const output = response.output;
  if (!Array.isArray(output)) return [];
  const calls: Array<{ call_id: string; name: string; arguments: JsonRecord }> = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type !== "function_call") continue;
    const callId = asString(item.call_id);
    const name = asString(item.name);
    let args: JsonRecord = {};
    if (typeof item.arguments === "string" && item.arguments.trim()) {
      try {
        const parsed = JSON.parse(item.arguments) as unknown;
        if (isRecord(parsed)) args = parsed;
      } catch {
        args = {};
      }
    } else if (isRecord(item.arguments)) {
      args = item.arguments;
    }
    if (callId && name) calls.push({ call_id: callId, name, arguments: args });
  }
  return calls;
}

function parseFinalJson(text: string): JsonRecord | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function refKey(ref: { slug: string; paragraph_number: number }) {
  return `${ref.slug}:${ref.paragraph_number}`;
}

async function rehydrateSelectedRefs(
  admin: SupabaseClient,
  refs: Array<{ slug: string; paragraph_number: number }>,
  meta: {
    query: string;
    conversationId: string;
    totalCount: number;
    pageSize: number;
    hasMore: boolean;
    nextOffset: number | null;
  },
): Promise<ConcordanceHit[]> {
  const exact = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const slug = ref.slug.trim();
    const paragraphNumber = Math.floor(Number(ref.paragraph_number));
    if (!slug || !Number.isFinite(paragraphNumber) || paragraphNumber < 1) continue;
    const key = `${slug}:${paragraphNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = await fetchSingleParagraphCandidate(admin, slug, paragraphNumber);
    if (c) exact.push(c);
  }

  const out: ConcordanceHit[] = [];
  for (const c of exact) {
    const neighbors = await fetchNeighborParagraphs(admin, c.slug, c.paragraph_number);
    out.push({
      slug: c.slug,
      title: c.title,
      location: c.location ?? null,
      date: c.preached_on ?? (c.year != null ? String(c.year) : null),
      paragraph_number: c.paragraph_number,
      paragraph_text: c.paragraph_text,
      prev_paragraph_number: neighbors.prev_paragraph_number,
      prev_paragraph_text: neighbors.prev_paragraph_text,
      next_paragraph_number: neighbors.next_paragraph_number,
      next_paragraph_text: neighbors.next_paragraph_text,
      _source: "chat",
      _query: meta.query,
      _conversation_id: meta.conversationId,
      _offset: 0,
      _page_size: meta.pageSize,
      _total_count: meta.totalCount,
      _has_more: meta.hasMore,
      _next_offset: meta.nextOffset,
    });
  }
  return out;
}

const tools = [
  {
    type: "function",
    name: "find_sermon_by_title_or_slug",
    description: "Trouve un sermon Moboko par titre, fragment de titre ou slug.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { title_or_slug: { type: "string" } },
      required: ["title_or_slug"],
    },
  },
  {
    type: "function",
    name: "get_paragraph_by_number",
    description: "Relit un paragraphe exact d'un sermon Moboko.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sermon_slug: { type: "string" },
        title_or_slug: { type: "string" },
        paragraph_number: { type: "number" },
        query: { type: "string" },
        page_size: { type: "number" },
      },
      required: ["paragraph_number", "query"],
    },
  },
  {
    type: "function",
    name: "search_paragraphs_global",
    description: "Recherche des paragraphes candidats dans toute la bibliotheque Moboko.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        offset: { type: "number" },
        page_size: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "search_paragraphs_in_sermon",
    description: "Recherche des paragraphes candidats dans un sermon precise.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sermon_slug: { type: "string" },
        title_or_slug: { type: "string" },
        query: { type: "string" },
        offset: { type: "number" },
        page_size: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "get_neighbor_paragraphs",
    description: "Retourne les paragraphes precedent et suivant autour d'une reference.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sermon_slug: { type: "string" },
        paragraph_number: { type: "number" },
      },
      required: ["sermon_slug", "paragraph_number"],
    },
  },
  {
    type: "function",
    name: "continue_last_scope",
    description: "Continue la derniere recherche avec la pagination memorisee.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        next_offset: { type: "number" },
        page_size: { type: "number" },
      },
      required: ["next_offset"],
    },
  },
  {
    type: "function",
    name: "rehydrate_result_refs",
    description: "Relit des references exactes selectionnees par le modele.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        refs: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              slug: { type: "string" },
              paragraph_number: { type: "number" },
            },
            required: ["slug", "paragraph_number"],
          },
        },
      },
      required: ["refs"],
    },
  },
  {
    type: "function",
    name: "open_previous_result",
    description: "Ouvre un resultat deja affiche par index 1-based.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { index: { type: "number" } },
      required: ["index"],
    },
  },
  {
    type: "function",
    name: "filter_previous_results",
    description: "Filtre les resultats deja affiches par annee ou criteres simples.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        year: { type: "number" },
        query: { type: "string" },
      },
      required: [],
    },
  },
] as const;

const finalJsonFormat = {
  type: "json_schema",
  name: "moboko_assistant_final",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["display_results", "display_empty", "open_result", "display_related_axes"],
      },
      understood_request: { type: "string" },
      active_topic: { type: "string" },
      selected_results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slug: { type: "string" },
            paragraph_number: { type: "number" },
            reason: { type: "string" },
          },
          required: ["slug", "paragraph_number", "reason"],
        },
      },
      total_relevant: { type: "number" },
      has_more: { type: "boolean" },
      next_offset: { type: ["number", "null"] },
      related_axes: {
        type: "array",
        items: { type: "string" },
      },
      user_message: { type: ["string", "null"] },
    },
    required: [
      "action",
      "understood_request",
      "active_topic",
      "selected_results",
      "total_relevant",
      "has_more",
      "next_offset",
      "related_axes",
      "user_message",
    ],
  },
} as const;

async function executeTool(
  admin: SupabaseClient,
  name: string,
  args: JsonRecord,
  ctx: {
    conversationId: string;
    userMessage: string;
    state: ConversationAssistantState;
    toolResultsByKey: Map<string, ConcordanceHit>;
  },
): Promise<JsonRecord> {
  const pageSize = Math.max(1, Math.min(20, Math.floor(Number(args.page_size ?? DEFAULT_PAGE_SIZE))));
  const query = expandToolQueryForRecall(asString(args.query) || ctx.userMessage);
  const scope = ctx.state.active_scope ?? { kind: "library" as const };

  if (name === "find_sermon_by_title_or_slug") {
    return tool_find_sermon_by_title_or_slug(admin, { title_or_slug: asString(args.title_or_slug) });
  }
  if (name === "get_paragraph_by_number") {
    const result = await tool_get_paragraph_by_number(admin, {
      sermon_slug: asString(args.sermon_slug),
      title_or_slug: asString(args.title_or_slug),
      paragraph_number: Number(args.paragraph_number),
      query,
      page_size: pageSize,
      conversation_id: ctx.conversationId,
      preferred_sermon_slug: ctx.state.active_sermon_slug ?? null,
    });
    for (const hit of result.results) ctx.toolResultsByKey.set(refKey(hit), hit);
    return summarizeToolResult(result);
  }
  if (name === "search_paragraphs_global") {
    const result = await tool_search_paragraphs_global(admin, {
      query,
      offset: Number(args.offset ?? 0),
      page_size: pageSize,
      conversation_id: ctx.conversationId,
    });
    for (const hit of result.results) ctx.toolResultsByKey.set(refKey(hit), hit);
    return summarizeToolResult(result);
  }
  if (name === "search_paragraphs_in_sermon") {
    const result = await tool_search_paragraphs_in_sermon(admin, {
      sermon_slug: asString(args.sermon_slug) || (scope.kind === "sermon" ? scope.sermon_slug : ""),
      title_or_slug: asString(args.title_or_slug),
      query,
      offset: Number(args.offset ?? 0),
      page_size: pageSize,
      conversation_id: ctx.conversationId,
      preferred_sermon_slug: ctx.state.active_sermon_slug ?? null,
    });
    for (const hit of result.results) ctx.toolResultsByKey.set(refKey(hit), hit);
    return summarizeToolResult(result);
  }
  if (name === "get_neighbor_paragraphs") {
    return tool_get_neighbor_paragraphs(admin, {
      sermon_slug: asString(args.sermon_slug),
      paragraph_number: Number(args.paragraph_number),
    });
  }
  if (name === "continue_last_scope") {
    const result = await tool_continue_last_scope(admin, {
      last_scope: scope,
      last_query: ctx.state.last_query ?? ctx.userMessage,
      next_offset: Number(args.next_offset ?? ctx.state.next_offset ?? 0),
      page_size: pageSize,
      conversation_id: ctx.conversationId,
    });
    for (const hit of result.results) ctx.toolResultsByKey.set(refKey(hit), hit);
    return summarizeToolResult(result);
  }
  if (name === "rehydrate_result_refs") {
    const refs = Array.isArray(args.refs) ? args.refs : [];
    const hits = await rehydrateSelectedRefs(
      admin,
      refs.filter(isRecord).map((r) => ({ slug: asString(r.slug), paragraph_number: Number(r.paragraph_number) })),
      {
        query: ctx.userMessage,
        conversationId: ctx.conversationId,
        totalCount: refs.length,
        pageSize: Math.max(1, refs.length),
        hasMore: false,
        nextOffset: null,
      },
    );
    for (const hit of hits) ctx.toolResultsByKey.set(refKey(hit), hit);
    return summarizeToolResult({
      ok: true,
      results: hits,
      total_count: hits.length,
      offset: 0,
      page_size: hits.length || 1,
      has_more: false,
      next_offset: null,
      scope,
    });
  }
  if (name === "open_previous_result") {
    const refs = ctx.state.active_result_refs ?? [];
    const idx = Math.max(0, Math.floor(Number(args.index ?? 1)) - 1);
    const ref = refs[idx];
    if (!ref) return { ok: false, error_code: "result_index_not_found", results: [] };
    const hits = await rehydrateSelectedRefs(admin, [ref], {
      query: ctx.state.last_query ?? ctx.userMessage,
      conversationId: ctx.conversationId,
      totalCount: 1,
      pageSize: 1,
      hasMore: false,
      nextOffset: null,
    });
    for (const hit of hits) ctx.toolResultsByKey.set(refKey(hit), hit);
    ctx.state.active_result_index = idx;
    return summarizeToolResult({
      ok: true,
      results: hits,
      total_count: hits.length,
      offset: 0,
      page_size: 1,
      has_more: false,
      next_offset: null,
      scope,
    });
  }
  if (name === "filter_previous_results") {
    const year = Number(args.year);
    const refs = ctx.state.active_result_refs ?? [];
    const filtered = Number.isFinite(year)
      ? refs.filter((r) => typeof r.date === "string" && r.date.startsWith(String(Math.floor(year))))
      : refs;
    const hits = await rehydrateSelectedRefs(admin, filtered, {
      query: asString(args.query) || ctx.state.last_query || ctx.userMessage,
      conversationId: ctx.conversationId,
      totalCount: filtered.length,
      pageSize: Math.max(1, filtered.length),
      hasMore: false,
      nextOffset: null,
    });
    for (const hit of hits) ctx.toolResultsByKey.set(refKey(hit), hit);
    return summarizeToolResult({
      ok: true,
      results: hits,
      total_count: hits.length,
      offset: 0,
      page_size: hits.length || 1,
      has_more: false,
      next_offset: null,
      scope,
    });
  }
  return { ok: false, error_code: "unknown_tool", results: [] };
}

function buildInstructions(state: ConversationAssistantState, historyItemsCount: number) {
  return `Tu es le cerveau conversationnel de Moboko Assistant.
Source doctrinale unique: sermons Moboko de William Branham fournis par les outils. Aucune connaissance externe, aucune citation inventee, aucun commentaire doctrinal.
Tu dois choisir et appeler les outils pour chercher, filtrer, ouvrir, continuer ou relire les paragraphes.
Les resultats d'outil sont seulement des candidats: selectionne uniquement les paragraphes qui repondent vraiment a la demande.
Pour "selon le Message", "selon le prophete", "Frere Branham", comprends source_scope=branham_sermons.
Pour "une seule chair": rejette mariage/femme/divorce/ceremonie/anecdote seuls; conserve seulement homme+femme/epoux + devenir un/une seule chair/ne sont plus deux.
Pour "mariage d'un predicateur": exige un lien reel entre ministere/predicateur/ministre/pasteur/serviteur de Dieu et mariage/epouse/epoux/mari/qualification familiale.
Pour "ouvre le premier", "suivant", "seulement 1963", "continue", utilise l'etat actif plutot que chercher ces mots.
Ne renvoie jamais de prose doctrinale visible. La sortie finale doit etre uniquement un JSON:
{"action":"display_results|display_empty|open_result|display_related_axes","understood_request":"...","active_topic":"...","selected_results":[{"slug":"...","paragraph_number":123,"reason":"..."}],"total_relevant":0,"has_more":false,"next_offset":null,"related_axes":["..."],"user_message":null}
Etat actif compact: ${JSON.stringify({
    active_topic: state.active_topic ?? null,
    active_scope: state.active_scope ?? { kind: "library" },
    active_sermon_slug: state.active_sermon_slug ?? null,
    active_result_refs: (state.active_result_refs ?? []).slice(0, 12),
    active_result_index: state.active_result_index ?? null,
    filters: state.filters ?? {},
    sort: state.sort ?? "chronological_asc",
    last_query: state.last_query ?? null,
    last_total_count: state.last_total_count ?? null,
    next_offset: state.next_offset ?? null,
    related_axes: state.related_axes ?? [],
    history_items_count: historyItemsCount,
  })}`;
}

function normIntentText(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandToolQueryForRecall(query: string) {
  const n = normIntentText(query);
  const mentionsMarriage = /\b(mariage|marier|marie|epouse|epoux|mari)\b/.test(n);
  const mentionsMinistry = /\b(predicateur|predication|ministre|ministere|pasteur|evangeliste|serviteur|homme de dieu)\b/.test(n);
  if (!mentionsMarriage || !mentionsMinistry) return query;
  return `${query} ministre predicateur pasteur evangeliste serviteur de Dieu homme appele au ministere epouse epoux mari marier mariage qualification familiale`;
}

async function deterministicLocalNavigation(opts: {
  admin: SupabaseClient;
  conversationId: string;
  userMessage: string;
  state: ConversationAssistantState;
}): Promise<OpenAiSermonAgentResult | null> {
  const intent = normIntentText(opts.userMessage);
  const refs = opts.state.active_result_refs ?? [];
  const currentIndex = Math.max(0, Math.floor(Number(opts.state.active_result_index ?? 0)));
  const scope = opts.state.active_scope ?? { kind: "library" as const };
  const baseDiagnostics = {
    openai_calls: 0,
    tool_calls_count: 1,
    tool_names: [] as string[],
    tool_outputs_returned: true,
    final_selection_count: 0,
    rehydrated_count: 0,
    previous_response_linked: Boolean(opts.state.last_openai_response_id),
    conversation_linked: Boolean(opts.conversationId),
    history_items_count: 0,
    failure_reason: null as string | null,
  };

  if (/^(ouvre|ouvrir|affiche|montre) (le )?(premier|deuxieme|deuxieme|troisieme|[0-9]+)/.test(intent)) {
    const word = intent.match(/(premier|deuxieme|troisieme|[0-9]+)/)?.[1] ?? "1";
    const idx = word === "premier" ? 0 : word === "deuxieme" ? 1 : word === "troisieme" ? 2 : Math.max(0, Number(word) - 1);
    const ref = refs[idx];
    if (!ref) return null;
    const hits = await rehydrateSelectedRefs(opts.admin, [ref], {
      query: opts.state.last_query ?? opts.userMessage,
      conversationId: opts.conversationId,
      totalCount: 1,
      pageSize: 1,
      hasMore: false,
      nextOffset: null,
    });
    if (hits.length === 0) return null;
    const nextState = { ...opts.state, active_result_refs: hits.map((h) => ({ slug: h.slug, paragraph_number: h.paragraph_number, title: h.title, date: h.date })), active_result_index: 0 };
    return {
      text: "",
      hits,
      totalCount: 1,
      hasMore: false,
      nextOffset: null,
      pageSize: 1,
      scope: hits[0] ? { kind: "sermon", sermon_slug: hits[0].slug } : scope,
      relatedAxes: opts.state.related_axes ?? [],
      assistantState: nextState,
      noCredit: true,
      diagnostics: { ...baseDiagnostics, tool_names: ["open_previous_result"], final_selection_count: hits.length, rehydrated_count: hits.length },
    };
  }

  const wantsNext = /\b(suivant|apres|prochain)\b/.test(intent);
  const wantsPrev = /\b(precedent|avant)\b/.test(intent);
  if ((wantsNext || wantsPrev) && refs[currentIndex]) {
    const ref = refs[currentIndex]!;
    const neighbors = await fetchNeighborParagraphs(opts.admin, ref.slug, ref.paragraph_number);
    const targetNumber = wantsNext ? neighbors.next_paragraph_number : neighbors.prev_paragraph_number;
    if (!targetNumber) return null;
    const target = { slug: ref.slug, paragraph_number: targetNumber };
    const hits = await rehydrateSelectedRefs(opts.admin, [target], {
      query: opts.state.last_query ?? opts.userMessage,
      conversationId: opts.conversationId,
      totalCount: 1,
      pageSize: 1,
      hasMore: false,
      nextOffset: null,
    });
    if (hits.length === 0) return null;
    const nextState = { ...opts.state, active_result_refs: hits.map((h) => ({ slug: h.slug, paragraph_number: h.paragraph_number, title: h.title, date: h.date })), active_result_index: 0 };
    return {
      text: "",
      hits,
      totalCount: 1,
      hasMore: false,
      nextOffset: null,
      pageSize: 1,
      scope: { kind: "sermon", sermon_slug: ref.slug },
      relatedAxes: opts.state.related_axes ?? [],
      assistantState: nextState,
      noCredit: true,
      diagnostics: { ...baseDiagnostics, tool_names: ["get_neighbor_paragraphs"], final_selection_count: hits.length, rehydrated_count: hits.length },
    };
  }

  if (/\b(continue|autres|suite|voir plus)\b/.test(intent) && opts.state.next_offset != null) {
    const result = await tool_continue_last_scope(opts.admin, {
      last_scope: scope,
      last_query: opts.state.last_query ?? opts.userMessage,
      next_offset: opts.state.next_offset,
      page_size: DEFAULT_PAGE_SIZE,
      conversation_id: opts.conversationId,
    });
    const nextState = {
      ...opts.state,
      active_result_refs: result.results.map((h) => ({ slug: h.slug, paragraph_number: h.paragraph_number, title: h.title, date: h.date })),
      active_result_index: 0,
      next_offset: result.next_offset,
      last_total_count: result.total_count,
    };
    return {
      text: result.results.length === 0 ? EMPTY_MESSAGE : "",
      hits: result.results,
      totalCount: result.total_count,
      hasMore: result.has_more,
      nextOffset: result.next_offset,
      pageSize: result.page_size,
      scope: result.scope,
      relatedAxes: opts.state.related_axes ?? [],
      assistantState: nextState,
      noCredit: true,
      diagnostics: { ...baseDiagnostics, tool_names: ["continue_last_scope"], final_selection_count: result.results.length, rehydrated_count: result.results.length },
    };
  }

  return null;
}

export async function runOpenAiSermonAgent(opts: {
  openai: OpenAI;
  admin: SupabaseClient;
  conversationId: string;
  userMessage: string;
  history: Array<{ role: string; kind: string; content: string | null }>;
  state: ConversationAssistantState;
  debug?: boolean;
}): Promise<OpenAiSermonAgentResult> {
  const model = getChatModel();
  const state = { ...opts.state };
  const localNav = await deterministicLocalNavigation({
    admin: opts.admin,
    conversationId: opts.conversationId,
    userMessage: opts.userMessage,
    state,
  });
  if (localNav) return localNav;
  const previousResponseId = state.last_openai_response_id ?? null;
  const diagnostics: OpenAiSermonAgentResult["diagnostics"] = {
    openai_calls: 0,
    tool_calls_count: 0,
    tool_names: [],
    tool_outputs_returned: false,
    final_selection_count: 0,
    rehydrated_count: 0,
    previous_response_linked: Boolean(previousResponseId),
    conversation_linked: Boolean(opts.conversationId),
    history_items_count: opts.history.length,
    failure_reason: null,
  };

  const toolResultsByKey = new Map<string, ConcordanceHit>();
  const historyBlock = compactHistory(opts.history);
  let response: JsonRecord;
  try {
    response = (await (opts.openai as unknown as { responses: { create: (args: JsonRecord) => Promise<unknown> } }).responses.create({
      model,
      instructions: buildInstructions(state, historyBlock.length),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                current_message: opts.userMessage,
                useful_history: historyBlock,
              }),
            },
          ],
        },
      ],
      tools,
      tool_choice: "auto",
      text: { format: finalJsonFormat },
      previous_response_id: previousResponseId || undefined,
      temperature: 0.15,
      max_output_tokens: 1400,
    })) as JsonRecord;
    diagnostics.openai_calls += 1;
  } catch (e) {
    diagnostics.failure_reason = "openai_initial_failed";
    throw e;
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const responseId = asString(response.id);
    if (responseId) state.last_openai_response_id = responseId;
    const calls = extractFunctionCalls(response);
    if (calls.length === 0) break;
    diagnostics.tool_calls_count += calls.length;
    diagnostics.tool_names.push(...calls.map((c) => c.name));
    const outputs = [];
    for (const call of calls) {
      const toolOut = await executeTool(opts.admin, call.name, call.arguments, {
        conversationId: opts.conversationId,
        userMessage: opts.userMessage,
        state,
        toolResultsByKey,
      });
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(toolOut),
      });
    }
    diagnostics.tool_outputs_returned = outputs.length > 0;
    response = (await (opts.openai as unknown as { responses: { create: (args: JsonRecord) => Promise<unknown> } }).responses.create({
      model,
      previous_response_id: responseId,
      input: outputs,
      tools,
      tool_choice: "auto",
      text: { format: finalJsonFormat },
      temperature: 0.12,
      max_output_tokens: 1400,
    })) as JsonRecord;
    diagnostics.openai_calls += 1;
  }

  const finalText = extractOutputText(response);
  const finalJson = parseFinalJson(finalText);
  if (!finalJson) {
    diagnostics.failure_reason = "final_json_missing";
    console.error("[moboko-openai] final_json_missing", {
      output_preview: sanitizeText(finalText, 220),
      output_types: Array.isArray(response.output)
        ? response.output.map((item) => (isRecord(item) ? item.type : typeof item)).slice(0, 8)
        : [],
      status: response.status ?? null,
      incomplete_details: response.incomplete_details ?? null,
    });
    throw new Error("assistant_final_json_missing");
  }

  const selectedRaw = Array.isArray(finalJson.selected_results) ? finalJson.selected_results : [];
  const selectedRefs = selectedRaw
    .filter(isRecord)
    .map((r) => ({ slug: asString(r.slug), paragraph_number: Number(r.paragraph_number) }))
    .filter((r) => r.slug && Number.isFinite(r.paragraph_number) && r.paragraph_number >= 1)
    .slice(0, 20);
  diagnostics.final_selection_count = selectedRefs.length;

  const totalRelevant =
    typeof finalJson.total_relevant === "number" && Number.isFinite(finalJson.total_relevant)
      ? Math.max(0, Math.floor(finalJson.total_relevant))
      : selectedRefs.length;
  const hasMore = finalJson.has_more === true;
  const nextOffset =
    typeof finalJson.next_offset === "number" && Number.isFinite(finalJson.next_offset)
      ? Math.max(0, Math.floor(finalJson.next_offset))
      : null;
  const relatedAxes = Array.isArray(finalJson.related_axes)
    ? finalJson.related_axes.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 3)
    : [];

  const hits = await rehydrateSelectedRefs(opts.admin, selectedRefs, {
    query: opts.userMessage,
    conversationId: opts.conversationId,
    totalCount: Math.max(totalRelevant, selectedRefs.length),
    pageSize: Math.max(1, selectedRefs.length || DEFAULT_PAGE_SIZE),
    hasMore,
    nextOffset,
  });
  diagnostics.rehydrated_count = hits.length;

  const scope: RetrievalScope =
    hits.length > 0 && hits.every((h) => h.slug === hits[0]!.slug)
      ? { kind: "sermon", sermon_slug: hits[0]!.slug }
      : state.active_scope ?? { kind: "library" };
  const activeRefs = hits.map((h) => ({
    slug: h.slug,
    paragraph_number: h.paragraph_number,
    title: h.title,
    date: h.date,
  }));

  const updatedState: ConversationAssistantState = {
    ...state,
    active_topic: asString(finalJson.active_topic) || state.active_topic || null,
    active_scope: scope,
    active_sermon_slug: scope.kind === "sermon" ? scope.sermon_slug : state.active_sermon_slug ?? null,
    active_result_refs: activeRefs.length > 0 ? activeRefs : state.active_result_refs ?? [],
    filters: state.filters ?? {},
    sort: "chronological_asc",
    last_query: opts.userMessage,
    last_search_plan: {
      understood_request: asString(finalJson.understood_request),
      action: asString(finalJson.action),
    },
    last_total_count: Math.max(totalRelevant, hits.length),
    next_offset: nextOffset,
    related_axes: relatedAxes,
  };

  const userMessage = asString(finalJson.user_message);
  return {
    text: hits.length === 0 ? userMessage || EMPTY_MESSAGE : "",
    hits,
    totalCount: Math.max(totalRelevant, hits.length),
    hasMore,
    nextOffset,
    pageSize: Math.max(1, hits.length || DEFAULT_PAGE_SIZE),
    scope,
    relatedAxes,
    assistantState: updatedState,
    diagnostics,
  };
}
