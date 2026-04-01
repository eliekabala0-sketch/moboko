import { clipForPrompt, type SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";
import { resolveHybridRetrieval } from "@/lib/sermons/retrieval-resolve";
import type { SemanticIntent } from "@/lib/sermons/semantic-intent";
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
  const routing =
    semantic != null
      ? `Plan retrieval: ${semantic.routing_source} (confiance ${semantic.confidence})`
      : "";
  return [
    `Question de l'utilisateur (français) :`,
    query,
    routing,
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

  const hybridLib = await resolveHybridRetrieval(admin, openai, query, {
    primarySlug: null,
    turnContextBlock: null,
    profile: "library",
  });
  const semantic = hybridLib.semantic;
  const candidates = hybridLib.candidates;
  const skipRankingLlm = hybridLib.skipRankingLlm;

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
  let rawJson = '{"picks":[]}';
  if (!skipRankingLlm) {
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

    try {
      const out = await runStructuredJsonCompletion(openai, messages, {
        maxTokens: 1200,
        temperature: 0.15,
        timeoutMs: 28_000,
      });
      if (out) rawJson = out;
    } catch (e) {
      console.error("[api/ai/sermons-search] completion", e);
      return NextResponse.json(
        { error: "erreur_ia", detail: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
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
