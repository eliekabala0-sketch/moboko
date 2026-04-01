import {
  clipForPrompt,
  fetchSermonSearchCandidates,
  type SermonParagraphCandidate,
} from "@/lib/sermons/ai-sermon-search-server";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { getOpenAIClient, runStructuredJsonCompletion } from "@/lib/ai/moboko-chat";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ALL_PUBLIC_APP_SETTING_KEYS,
  parseAppSettingScalar,
  PUBLIC_APP_SETTING_KEYS,
} from "@moboko/shared";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 90;

type Body = { query?: string; offset?: number; pageSize?: number };
const CONCORDANCE_PAGE_SIZE = 20;
const EMPTY_CONCORDANCE_MESSAGE = "Aucun paragraphe exact trouvé pour cette recherche.";
const SOURCE_ONLY_JSON = `Moboko ne répond que par le JSON demandé, aucun texte libre, aucune connaissance hors base.`;

type SemanticIntent = {
  search_mode:
    | "exact_quote_search"
    | "theme_search"
    | "situation_search"
    | "story_search"
    | "prayer_search"
    | "doctrinal_search"
    | "time_bounded_search"
    | "preaching_prep_search"
    | "comfort_or_exhortation_search"
    | "sermon_title_then_topic_search";
  user_need:
    | "simple_answer"
    | "orientation"
    | "exhortation"
    | "comfort"
    | "preaching_prep"
    | "citation_list"
    | "prayer_list"
    | "story_list";
  intent: string;
  topic: string;
  concepts: string[];
  expansions: string[];
  content_types: string[];
  quoted_phrase: string | null;
  sermon_hint: string | null;
  year_from: number | null;
  year_to: number | null;
  maybe_meant: string | null;
  retrieval_phrases: string[];
  avoid_lexical_bait: string[];
  passage_brief: string;
  restrict_sermon_slug: string | null;
  follow_up_continuity: boolean;
};

function parseBody(raw: unknown): { query: string; offset: number; pageSize: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Body;
  const q = obj.query;
  if (typeof q !== "string") return null;
  const t = q.trim();
  if (t.length < 8 || t.length > 2000) return null;
  const offset =
    typeof obj.offset === "number" && Number.isFinite(obj.offset) ? Math.max(0, Math.floor(obj.offset)) : 0;
  const requestedPageSize =
    typeof obj.pageSize === "number" && Number.isFinite(obj.pageSize)
      ? Math.floor(obj.pageSize)
      : CONCORDANCE_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(50, requestedPageSize));
  return { query: t, offset, pageSize };
}

function normQueryTokens(s: string): string[] {
  const t = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function isShallowBaitOnly(q: string, bait: Set<string>): boolean {
  const words = normQueryTokens(q);
  if (words.length === 0) return true;
  if (words.length > 3) return false;
  return words.every((w) => bait.has(w));
}

function dedupeQueries(parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.trim();
    if (t.length < 3) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

type AiPick = { i?: number };

function parseAiPicks(raw: string, n: number): { picks: AiPick[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const arr = o.picks;
  if (arr === undefined) {
    return { picks: [] };
  }
  if (!Array.isArray(arr)) return null;
  const picks: AiPick[] = [];
  const used = new Set<number>();
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    const i = typeof p.i === "number" && Number.isInteger(p.i) ? p.i : null;
    if (i === null || i < 1 || i > n || used.has(i)) continue;
    used.add(i);
    picks.push({ i });
    if (picks.length >= 80) break;
  }
  return { picks };
}

function buildRankingPrompt(
  query: string,
  semantic: SemanticIntent | null,
  candidates: SermonParagraphCandidate[],
): string {
  const lines = candidates.map((c, idx) => {
    const y = c.year != null ? String(c.year) : "";
    const clip = clipForPrompt(c.paragraph_text);
    return `${idx + 1}\t${c.slug}\t${c.title.replace(/\s+/g, " ").trim()}\t${y}\t${c.paragraph_number}\t${clip}`;
  });
  const pb = semantic?.passage_brief?.trim();
  const types = (semantic?.content_types ?? []).join(", ");
  const scope =
    semantic?.restrict_sermon_slug ? `Périmètre sermon (slug): ${semantic.restrict_sermon_slug}` : "Périmètre: bibliothèque";
  return [
    `Question de l'utilisateur (français) :`,
    query,
    semantic?.intent ? `Intent : ${semantic.intent}` : "",
    semantic?.search_mode ? `Mode : ${semantic.search_mode}` : "",
    semantic?.topic ? `Thème : ${semantic.topic}` : "",
    semantic?.concepts?.length ? `Concepts : ${semantic.concepts.join(", ")}` : "",
    types ? `Types de passage visés : ${types}` : "",
    scope,
    pb
      ? `Critères sémantiques (respecter : adéquation réelle au besoin ; écarter matches lexicaux trompeurs) : ${pb}`
      : "",
    "",
    "Extraits numérotés (TSV : n° | slug | titre | année | n° paragraphe | extrait). Réponds uniquement avec des indices i valides.",
    lines.join("\n"),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function toPagedHits(
  ordered: SermonParagraphCandidate[],
  offset: number,
  pageSize: number,
  query: string,
) {
  const safeOffset = Math.max(0, offset);
  const end = Math.min(ordered.length, safeOffset + pageSize);
  const page = ordered.slice(safeOffset, end);
  const hasMore = end < ordered.length;
  return {
    page,
    totalCount: ordered.length,
    hasMore,
    nextOffset: hasMore ? end : null,
    query,
    offset: safeOffset,
    pageSize,
  };
}

function parseSemanticIntent(raw: string): SemanticIntent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const modeRaw =
    typeof o.search_mode === "string" ? o.search_mode.trim() : "theme_search";
  const search_mode: SemanticIntent["search_mode"] = (
    [
      "exact_quote_search",
      "theme_search",
      "situation_search",
      "story_search",
      "prayer_search",
      "doctrinal_search",
      "time_bounded_search",
      "preaching_prep_search",
      "comfort_or_exhortation_search",
      "sermon_title_then_topic_search",
    ] as const
  ).includes(modeRaw as SemanticIntent["search_mode"])
    ? (modeRaw as SemanticIntent["search_mode"])
    : "theme_search";
  const needRaw =
    typeof o.user_need === "string" ? o.user_need.trim() : "orientation";
  const user_need: SemanticIntent["user_need"] = (
    [
      "simple_answer",
      "orientation",
      "exhortation",
      "comfort",
      "preaching_prep",
      "citation_list",
      "prayer_list",
      "story_list",
    ] as const
  ).includes(needRaw as SemanticIntent["user_need"])
    ? (needRaw as SemanticIntent["user_need"])
    : "orientation";
  const intent = typeof o.intent === "string" ? o.intent.trim().slice(0, 240) : "";
  const topic = typeof o.topic === "string" ? o.topic.trim().slice(0, 200) : "";
  const maybe_meant = typeof o.maybe_meant === "string" ? o.maybe_meant.trim().slice(0, 240) : null;
  const quoted_phrase =
    typeof o.quoted_phrase === "string" ? o.quoted_phrase.trim().slice(0, 240) : null;
  const sermon_hint =
    typeof o.sermon_hint === "string" ? o.sermon_hint.trim().slice(0, 240) : null;
  const year_from =
    typeof o.year_from === "number" && Number.isFinite(o.year_from)
      ? Math.max(1900, Math.min(2100, Math.floor(o.year_from)))
      : null;
  const year_to =
    typeof o.year_to === "number" && Number.isFinite(o.year_to)
      ? Math.max(1900, Math.min(2100, Math.floor(o.year_to)))
      : null;
  const concepts = Array.isArray(o.concepts)
    ? o.concepts
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const expansions = Array.isArray(o.expansions)
    ? o.expansions
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const content_types = Array.isArray(o.content_types)
    ? o.content_types
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const retrieval_phrases = Array.isArray(o.retrieval_phrases)
    ? o.retrieval_phrases
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const avoid_lexical_bait = Array.isArray(o.avoid_lexical_bait)
    ? o.avoid_lexical_bait
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const passage_brief =
    typeof o.passage_brief === "string" ? o.passage_brief.trim().slice(0, 420) : "";
  const restrict_sermon_slug =
    typeof o.restrict_sermon_slug === "string" && o.restrict_sermon_slug.trim()
      ? o.restrict_sermon_slug.trim().slice(0, 220)
      : null;
  const follow_up_continuity = o.follow_up_continuity === true;
  return {
    search_mode,
    user_need,
    intent,
    topic,
    concepts,
    expansions,
    content_types,
    quoted_phrase,
    sermon_hint,
    year_from,
    year_to,
    maybe_meant,
    retrieval_phrases,
    avoid_lexical_bait,
    passage_brief,
    restrict_sermon_slug,
    follow_up_continuity,
  };
}

async function extractSemanticIntent(
  openai: NonNullable<ReturnType<typeof getOpenAIClient>>,
  query: string,
): Promise<SemanticIntent | null> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${SOURCE_ONLY_JSON}

Tu analyses une requête en français pour rechercher des passages de sermons dans la base Moboko (aucun texte libre pour l’utilisateur).

Retourne UNIQUEMENT un JSON :
{"search_mode":"...","user_need":"...","intent":"...","topic":"...","concepts":["..."],"expansions":["..."],"content_types":["..."],"quoted_phrase":"...|null","sermon_hint":"...|null","year_from":1963|null,"year_to":1965|null,"maybe_meant":"...|null","retrieval_phrases":["..."],"avoid_lexical_bait":["..."],"passage_brief":"...","restrict_sermon_slug":"...|null","follow_up_continuity":false}

search_mode / user_need : ensembles inchangés (exact_quote_search … sermon_title_then_topic_search).

Règles :
- Comprends le SENS et le type de passage (récit, prière effective, exegesis ciblée, thème restreint à un sermon si mentionné), pas une liste de mots de la question.
- retrieval_phrases : 3–8 phrases substantives pour interroger la base (éviter de n’envoyer que des mots surface piège comme « histoire » quand la demande est « il raconte des histoires »).
- avoid_lexical_bait : mots à ne pas utiliser seuls comme requête FTS.
- passage_brief : phrase interne de critères pour le classement (adéquation / faux positifs).
- restrict_sermon_slug : slug si l’utilisateur limite à un sermon nommé ou identifié, sinon null.
- follow_up_continuity : false pour cette API (pas d’historique conversation).
- Tolérance orthographe et reformulations comme avant.`,
    },
    { role: "user", content: query },
  ];
  const raw = await runStructuredJsonCompletion(openai, messages, {
    maxTokens: 560,
    temperature: 0.08,
    timeoutMs: 26_000,
  });
  if (!raw) return null;
  return parseSemanticIntent(raw);
}

async function fetchSemanticCandidates(
  admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  query: string,
  sem: SemanticIntent | null,
) {
  const bait = new Set(sem?.avoid_lexical_bait ?? []);
  const restrict = sem?.restrict_sermon_slug?.trim() ?? null;
  const quoted = sem?.quoted_phrase ? [sem.quoted_phrase] : [];
  const titleThenTopic =
    sem?.search_mode === "sermon_title_then_topic_search" && sem?.sermon_hint
      ? [`${sem.sermon_hint} ${sem.topic || query}`]
      : [];
  const candidatesRaw = dedupeQueries([
    ...(sem?.retrieval_phrases ?? []),
    sem?.intent ?? "",
    sem?.topic ?? "",
    ...quoted,
    ...titleThenTopic,
    ...(sem?.expansions ?? []),
    ...(sem?.concepts ?? []),
    query,
  ]).filter((q) => !isShallowBaitOnly(q, bait));

  const queries = candidatesRaw.slice(0, 28);
  const MAX_CANDIDATES = 1200;
  const byKey = new Map<string, SermonParagraphCandidate>();
  const collect = async (q: string) => {
    const rows = await fetchSermonSearchCandidates(admin, q);
    for (const c of rows) {
      if (restrict && c.slug !== restrict) continue;
      const k = `${c.slug}:${c.paragraph_number}`;
      if (!byKey.has(k)) byKey.set(k, c);
      if (byKey.size >= MAX_CANDIDATES) break;
    }
  };

  for (const q of queries.slice(0, 8)) {
    await collect(q);
    if (byKey.size >= 380) break;
  }
  if (byKey.size < 800) {
    for (const q of queries.slice(8, 18)) {
      await collect(q);
      if (byKey.size >= 900) break;
    }
  }
  if (byKey.size < 900) {
    const broad = dedupeQueries([sem?.intent ?? "", sem?.topic ?? "", ...(sem?.concepts ?? []).slice(0, 5)])
      .filter((x) => x.length >= 4 && !isShallowBaitOnly(x, bait))
      .join(" ");
    if (broad.trim().length >= 4 && !isShallowBaitOnly(broad, bait)) await collect(broad);
    for (const q of queries.slice(18)) {
      await collect(q);
      if (byKey.size >= MAX_CANDIDATES) break;
    }
  }
  let out = Array.from(byKey.values());
  if (restrict) {
    out = out.filter((c) => c.slug === restrict);
  }
  if (sem?.year_from != null || sem?.year_to != null) {
    const minY = sem.year_from ?? 1900;
    const maxY = sem.year_to ?? 2100;
    out = out.filter((c) => c.year == null || (c.year >= minY && c.year <= maxY));
  }
  const score = (c: SermonParagraphCandidate) => {
    const t = c.paragraph_text.toLowerCase();
    let s = 0;
    if (sem?.search_mode === "exact_quote_search" && sem.quoted_phrase) {
      if (t.includes(sem.quoted_phrase.toLowerCase())) s += 12;
    }
    if (sem?.topic && t.includes(sem.topic.toLowerCase())) s += 2;
    return s;
  };
  out.sort((a, b) => score(b) - score(a));
  return out.slice(0, MAX_CANDIDATES);
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

  let query: string;
  let offset = 0;
  let pageSize = CONCORDANCE_PAGE_SIZE;
  try {
    const json = (await request.json()) as unknown;
    const p = parseBody(json);
    if (!p) {
      return NextResponse.json(
        { error: "requete_invalide", detail: "Texte entre 8 et 2000 caractères requis." },
        { status: 400 },
      );
    }
    query = p.query;
    offset = p.offset;
    pageSize = p.pageSize;
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
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

  const aiEnabled = Boolean(settings[PUBLIC_APP_SETTING_KEYS.sermonAiSearchEnabled]);
  if (!aiEnabled) {
    return NextResponse.json({ error: "sermon_ia_desactive" }, { status: 403 });
  }

  const creditCost = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.sermonAiSearchCreditCost] ?? 2)),
  );

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

  let semantic: SemanticIntent | null = null;
  try {
    semantic = await extractSemanticIntent(openai, query);
  } catch {
    semantic = null;
  }

  const candidates = await fetchSemanticCandidates(admin, query, semantic);

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      results: [],
      total_count: 0,
      offset,
      page_size: pageSize,
      has_more: false,
      next_offset: null,
      message: EMPTY_CONCORDANCE_MESSAGE,
      credits_charged: 0,
      credit_cost: creditCost,
      balance_after: balance,
      billing_skipped: billingExempt,
    });
  }

  const isFirstPage = offset === 0;

  if (isFirstPage && !billingExempt && creditCost > 0 && balance < creditCost) {
    return NextResponse.json(
      {
        error: "credits_insuffisants",
        message: `Il vous faut ${creditCost} crédit(s) pour la recherche IA (solde : ${balance}).`,
        balance,
        required: creditCost,
      },
      { status: 402 },
    );
  }

  const rerankPool = candidates.slice(0, 320);
  const userPrompt = buildRankingPrompt(query, semantic, rerankPool);
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${SOURCE_ONLY_JSON}

Tu classes des extraits de sermons déjà tirés de la base (liste numérotée).
Privilégie l’adéquation sémantique au besoin et au type de passage décrit ; refuse les extraits qui ne partagent qu’un mot avec la question sans correspondre au sens.
N'invente jamais de numéro : uniquement des "i" présents dans la liste.
Réponds UNIQUEMENT par un JSON valide : {"picks":[{"i":1},...]}
Maximum 80 entrées, les plus pertinentes en premier. Aucun summary, aucune note, aucun texte hors JSON.
Si rien ne convient : {"picks":[]}`,
    },
    { role: "user", content: userPrompt },
  ];

  let rawJson: string;
  try {
    rawJson = await runStructuredJsonCompletion(openai, messages, {
      maxTokens: 1200,
      temperature: 0.15,
      timeoutMs: 28_000,
    });
  } catch (e) {
    console.error("[api/ai/sermons-search] completion", e);
    return NextResponse.json(
      { error: "erreur_ia", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  if (!rawJson) {
    return NextResponse.json({ error: "reponse_ia_vide" }, { status: 502 });
  }

  const parsed = parseAiPicks(rawJson, rerankPool.length);
  if (parsed === null) {
    return NextResponse.json(
      { error: "reponse_ia_invalide", detail: "Le classement IA n’a pas pu être interprété." },
      { status: 502 },
    );
  }

  const { picks } = parsed;
  const aiRanked = picks
    .filter((pick): pick is { i: number } => typeof pick.i === "number")
    .map((pick) => rerankPool[pick.i - 1])
    .filter((c): c is SermonParagraphCandidate => Boolean(c));
  const aiKeys = new Set(aiRanked.map((c) => `${c.slug}:${c.paragraph_number}`));
  const ordered = [...aiRanked, ...candidates.filter((c) => !aiKeys.has(`${c.slug}:${c.paragraph_number}`))];
  const page = toPagedHits(ordered, offset, pageSize, query);

  const results: Record<string, unknown>[] = [];
  for (const c of page.page) {
    const n = await fetchNeighborParagraphs(admin, c.slug, c.paragraph_number);
    results.push({
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
      _source: "sermons-search",
      _query: page.query,
      _offset: page.offset,
      _page_size: page.pageSize,
      _next_offset: page.nextOffset,
      _has_more: page.hasMore,
      _total_count: page.totalCount,
    });
  }

  let balanceAfter = balance;
  let billingSkipped = billingExempt;
  let creditsDebited = 0;

  if (isFirstPage && creditCost > 0) {
    const { data: debit, error: dErr } = await admin.rpc("consume_credits_atomic", {
      p_user_id: user.id,
      p_amount: creditCost,
      p_reason: "sermon_ai_search",
      p_ref_type: "sermon_ai_search",
      p_ref_id: null,
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
        },
        { status: 500 },
      );
    }
    billingSkipped = Boolean(debitObj.billing_skipped);
    if (typeof debitObj.balance_after === "number") {
      balanceAfter = debitObj.balance_after;
    }
    creditsDebited = billingSkipped ? 0 : creditCost;
  }

  return NextResponse.json({
    ok: true,
    results,
    total_count: page.totalCount,
    offset: page.offset,
    page_size: page.pageSize,
    has_more: page.hasMore,
    next_offset: page.nextOffset,
    message: page.totalCount === 0 ? EMPTY_CONCORDANCE_MESSAGE : null,
    credits_charged: creditsDebited,
    credit_cost: creditCost,
    balance_after: balanceAfter,
    billing_skipped: billingSkipped,
  });
}
