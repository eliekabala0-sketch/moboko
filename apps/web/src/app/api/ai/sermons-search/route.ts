import { fetchSermonSearchCandidates, type SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { fetchConcordanceSemanticCandidates } from "@/lib/sermons/concordance-fetch-candidates";
import { tryDeterministicRetrieval } from "@/lib/sermons/retrieval-deterministic";
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
const EMPTY_CONCORDANCE_MESSAGE = "Aucun paragraphe exact trouvé pour cette recherche.";

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

  // Côté sermons : recherche SANS IA (déterministe + FTS local).
  const det = await tryDeterministicRetrieval(admin, query, { primarySlug: null });
  const semantic = det?.semantic ?? null;
  const candidates =
    det?.preFetchedCandidates != null
      ? det.preFetchedCandidates
      : semantic
        ? await fetchConcordanceSemanticCandidates(admin, query, semantic, "library")
        : await fetchSermonSearchCandidates(admin, query);

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
      credit_cost: 0,
      balance_after: balance,
      billing_skipped: billingExempt,
    });
  }

  const ordered = candidates;
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

  return NextResponse.json({
    ok: true,
    results,
    total_count: page.totalCount,
    offset: page.offset,
    page_size: page.pageSize,
    has_more: page.hasMore,
    next_offset: page.nextOffset,
    message: page.totalCount === 0 ? EMPTY_CONCORDANCE_MESSAGE : null,
    credits_charged: 0,
    credit_cost: 0,
    balance_after: balance,
    billing_skipped: billingExempt,
    scope: semantic?.restrict_sermon_slug ? { kind: "sermon", sermon_slug: semantic.restrict_sermon_slug } : { kind: "library" },
  });
}
