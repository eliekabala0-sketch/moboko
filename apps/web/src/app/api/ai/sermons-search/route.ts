import { fetchSermonSearchCandidates, type SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { getOpenAIClient } from "@/lib/ai/moboko-chat";
import { resolveHybridRetrieval } from "@/lib/sermons/retrieval-resolve";
import { ensureMonthlySubscriptionCredits } from "@/lib/billing/subscription-credits";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ALL_PUBLIC_APP_SETTING_KEYS,
  parseAppSettingScalar,
  PUBLIC_APP_SETTING_KEYS,
} from "@moboko/shared";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 90;

type Body = { query?: string; offset?: number; pageSize?: number };
const CONCORDANCE_PAGE_SIZE = 20;
const EMPTY_CONCORDANCE_MESSAGE = "Aucun passage correspondant n'a ete trouve.";

function aiLog(event: string, meta: Record<string, unknown> = {}) {
  if (process.env.MOBOKO_ASSISTANT_AI_DEBUG !== "1") return;
  console.log(`[assistant-ai] ${event}`, meta);
}

function diagnosticsEnabled(request: Request) {
  return request.headers.get("x-moboko-diagnostics") === "1";
}

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
  const startedAt = Date.now();
  const includeDiagnostics = diagnosticsEnabled(request);
  const diagnostics: Record<string, unknown> = {
    openai_calls: 0,
    candidate_count: 0,
    rehydrated_count: 0,
    used_fast_search_rpc: false,
    intent_mode: null,
    intent_received: false,
    retrieval_route: null,
    fallback_reason: null,
  };
  aiLog("request_start");
  const admin = createSupabaseServiceClient();
  if (!admin) {
    aiLog("failure_reason", { reason: "supabase_service_missing" });
    return NextResponse.json(
      { error: "service_supabase_manquant", detail: "SUPABASE_SERVICE_ROLE_KEY requise." },
      { status: 500 },
    );
  }

  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) {
    aiLog("failure_reason", { reason: "auth_required" });
    return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  }

  const openai = getOpenAIClient();
  aiLog("openai_status", { configured: Boolean(openai) });

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
    aiLog("failure_reason", { reason: "assistant_disabled" });
    return NextResponse.json({ error: "sermon_ia_desactive" }, { status: 403 });
  }
  const isContinuationPage = offset > 0;
  const creditCost = isContinuationPage
    ? 0
    : Math.max(0, Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.sermonAiSearchCreditCost] ?? 2)));
  const subscriptionMonthlyCredits = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.subscriptionMonthlyAiCredits] ?? 0)),
  );

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

  // Recherche assistee : comprehension IA, puis extraction exacte depuis Supabase.
  if (!billingExempt && creditCost > 0 && balance < creditCost) {
    aiLog("failure_reason", { reason: "insufficient_credits" });
    return NextResponse.json(
      {
        error: "credits_insuffisants",
        message: `Il vous faut ${creditCost} credit(s) pour cette action (solde : ${balance}).`,
        balance,
        required: creditCost,
      },
      { status: 402 },
    );
  }

  let semantic: Awaited<ReturnType<typeof resolveHybridRetrieval>>["semantic"] = null;
  let candidates: SermonParagraphCandidate[];
  if (isContinuationPage) {
    candidates = await fetchSermonSearchCandidates(admin, query);
    diagnostics.candidate_count = candidates.length;
    diagnostics.used_fast_search_rpc = candidates.some((c) => c.prev_paragraph_number !== undefined || c.next_paragraph_number !== undefined);
    diagnostics.retrieval_route = "continuation";
    aiLog("candidate_count", { count: candidates.length, continuation: true });
  } else {
    if (!openai) {
      aiLog("failure_reason", { reason: "openai_missing" });
      return NextResponse.json(
        { error: "openai_non_configure", detail: "OPENAI_API_KEY manquante cote serveur." },
        { status: 503 },
      );
    }
    aiLog("openai_called");
    diagnostics.openai_calls = 1;
    let retrieval: Awaited<ReturnType<typeof resolveHybridRetrieval>>;
    try {
      retrieval = await resolveHybridRetrieval(admin, openai, query, {
        primarySlug: null,
        turnContextBlock: null,
        profile: "library",
        agentFirst: true,
      });
    } catch (e) {
      aiLog("failure_reason", { reason: "retrieval_failed" });
      return NextResponse.json(
        {
          error: "recherche_assistee_echouee",
          detail: e instanceof Error ? e.message : "Erreur de comprehension ou de recherche.",
          ...(includeDiagnostics ? { diagnostics: { ...diagnostics, duration_ms: Date.now() - startedAt } } : {}),
        },
        { status: 502 },
      );
    }
    semantic = retrieval.semantic;
    candidates = retrieval.candidates;
    diagnostics.candidate_count = candidates.length;
    diagnostics.used_fast_search_rpc = candidates.some((c) => c.prev_paragraph_number !== undefined || c.next_paragraph_number !== undefined);
    diagnostics.intent_mode = semantic?.search_mode ?? null;
    diagnostics.intent_received = Boolean(semantic);
    diagnostics.retrieval_route = retrieval.usedRetrievalAgent ? "agent" : "deterministic_fallback";
    diagnostics.fallback_reason = retrieval.fallbackReason;
    aiLog("intent_received", {
      has_intent: Boolean(semantic),
      mode: semantic?.search_mode ?? null,
      routed_by: retrieval.usedRetrievalAgent ? "agent" : "deterministic_fallback",
    });
    aiLog("candidate_count", { count: candidates.length });
  }

  let balanceAfter = balance;
  let billingSkipped = billingExempt;
  if (creditCost > 0) {
    const { data: debit, error: dErr } = await admin.rpc("consume_credits_atomic", {
      p_user_id: user.id,
      p_amount: creditCost,
      p_reason: "sermon_ai_search",
      p_ref_type: "sermons_search",
      p_ref_id: null,
    });
    const debitObj = debit as { ok?: boolean; balance_after?: number; billing_skipped?: boolean } | null;
    if (dErr || !debitObj || debitObj.ok !== true) {
      aiLog("failure_reason", { reason: "credit_debit_failed" });
      return NextResponse.json(
        { error: "debit_credits_echoue", detail: debitObj ?? dErr?.message },
        { status: 500 },
      );
    }
    billingSkipped = Boolean(debitObj.billing_skipped);
    if (typeof debitObj.balance_after === "number") balanceAfter = debitObj.balance_after;
  }
  const creditsCharged = billingSkipped ? 0 : creditCost;
  aiLog("credits_charged", { amount: creditsCharged, skipped: billingSkipped });

  if (candidates.length === 0) {
    diagnostics.rehydrated_count = 0;
    aiLog("rehydrated_count", { count: 0 });
    aiLog("final_count", { count: 0, ms: Date.now() - startedAt });
    return NextResponse.json({
      ok: true,
      results: [],
      total_count: 0,
      offset,
      page_size: pageSize,
      has_more: false,
      next_offset: null,
      message: EMPTY_CONCORDANCE_MESSAGE,
      credits_charged: creditsCharged,
      credit_cost: creditCost,
      balance_after: balanceAfter,
      billing_skipped: billingSkipped,
      ...(includeDiagnostics ? { diagnostics: { ...diagnostics, duration_ms: Date.now() - startedAt } } : {}),
    });
  }

  const ordered = candidates;
  const page = toPagedHits(ordered, offset, pageSize, query);

  const results: Record<string, unknown>[] = [];
  for (const c of page.page) {
    const hasHydratedNeighbors =
      c.prev_paragraph_number !== undefined ||
      c.prev_paragraph_text !== undefined ||
      c.next_paragraph_number !== undefined ||
      c.next_paragraph_text !== undefined;
    const n = hasHydratedNeighbors
      ? {
          prev_paragraph_number: c.prev_paragraph_number ?? null,
          prev_paragraph_text: c.prev_paragraph_text ?? null,
          next_paragraph_number: c.next_paragraph_number ?? null,
          next_paragraph_text: c.next_paragraph_text ?? null,
        }
      : await fetchNeighborParagraphs(admin, c.slug, c.paragraph_number);
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
  diagnostics.rehydrated_count = results.length;
  aiLog("rehydrated_count", { count: results.length });
  aiLog("final_count", { count: results.length, total: page.totalCount, ms: Date.now() - startedAt });

  return NextResponse.json({
    ok: true,
    results,
    total_count: page.totalCount,
    offset: page.offset,
    page_size: page.pageSize,
    has_more: page.hasMore,
    next_offset: page.nextOffset,
    message: page.totalCount === 0 ? EMPTY_CONCORDANCE_MESSAGE : null,
    credits_charged: creditsCharged,
    credit_cost: creditCost,
    balance_after: balanceAfter,
    billing_skipped: billingSkipped,
    scope: semantic?.restrict_sermon_slug ? { kind: "sermon", sermon_slug: semantic.restrict_sermon_slug } : { kind: "library" },
    ...(includeDiagnostics ? { diagnostics: { ...diagnostics, duration_ms: Date.now() - startedAt } } : {}),
  });
}
