import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetrievalOrchestratorResult, RetrievalScope } from "@/lib/chat/sermon-retrieval-types";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { fetchSingleParagraphCandidate, resolveUniqueSermonSlugByTitle } from "@/lib/sermons/retrieval-direct";
import { fetchSermonSearchCandidates } from "@/lib/sermons/ai-sermon-search-server";
import type { SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";

function toHitBase(c: SermonParagraphCandidate) {
  return {
    slug: c.slug,
    title: c.title,
    location: c.location ?? null,
    date: (c.preached_on && String(c.preached_on).trim()) || (c.year != null ? String(c.year) : null),
    paragraph_number: c.paragraph_number,
    paragraph_text: c.paragraph_text,
  };
}

async function enrichWithNeighbors(
  admin: SupabaseClient,
  c: SermonParagraphCandidate,
  meta: {
    source: "chat";
    query: string;
    conversationId: string;
    offset: number;
    pageSize: number;
    nextOffset: number | null;
    hasMore: boolean;
    totalCount: number;
  },
) {
  const n = await fetchNeighborParagraphs(admin, c.slug, c.paragraph_number);
  return {
    ...toHitBase(c),
    prev_paragraph_number: n.prev_paragraph_number,
    prev_paragraph_text: n.prev_paragraph_text,
    next_paragraph_number: n.next_paragraph_number,
    next_paragraph_text: n.next_paragraph_text,
    _source: meta.source,
    _query: meta.query,
    _conversation_id: meta.conversationId,
    _offset: meta.offset,
    _page_size: meta.pageSize,
    _next_offset: meta.nextOffset,
    _has_more: meta.hasMore,
    _total_count: meta.totalCount,
  } as const;
}

function pageSlice<T>(items: T[], offset: number, pageSize: number) {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safePageSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
  const end = Math.min(items.length, safeOffset + safePageSize);
  const page = items.slice(safeOffset, end);
  const hasMore = end < items.length;
  return {
    offset: safeOffset,
    pageSize: safePageSize,
    page,
    totalCount: items.length,
    hasMore,
    nextOffset: hasMore ? end : null,
  };
}

async function resolveSermonSlugFromHint(
  admin: SupabaseClient,
  titleOrSlug: string,
  queryHint: string,
): Promise<string | null> {
  const resolved = await tool_find_sermon_by_title_or_slug(admin, { title_or_slug: titleOrSlug });
  if (resolved.scope.kind === "sermon") return resolved.scope.sermon_slug;

  // Fallback: infère le sermon dominant depuis les résultats globaux.
  const seeded = await fetchSermonSearchCandidates(admin, `${titleOrSlug} ${queryHint}`.trim());
  if (seeded.length === 0) return null;
  const bySlug = new Map<string, number>();
  for (const c of seeded.slice(0, 80)) {
    bySlug.set(c.slug, (bySlug.get(c.slug) ?? 0) + 1);
  }
  const top = [...bySlug.entries()].sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? null;
}

export async function tool_find_sermon_by_title_or_slug(
  admin: SupabaseClient,
  args: { title_or_slug: string },
): Promise<{ ok: true; scope: RetrievalScope; sermon_title: string | null; sermon_slug: string | null }> {
  const raw = (args.title_or_slug ?? "").trim();
  if (!raw) return { ok: true, scope: { kind: "library" }, sermon_title: null, sermon_slug: null };
  const slugCand = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

  // 1) Essai slug direct.
  const { data: bySlug } = await admin
    .from("sermons")
    .select("slug, title")
    .eq("is_published", true)
    .eq("slug", raw)
    .maybeSingle();
  if (bySlug?.slug && bySlug?.title) {
    return { ok: true, scope: { kind: "sermon", sermon_slug: bySlug.slug }, sermon_title: bySlug.title, sermon_slug: bySlug.slug };
  }

  // 2) Essai slug normalisé.
  if (slugCand && slugCand !== raw) {
    const { data: bySlug2 } = await admin
      .from("sermons")
      .select("slug, title")
      .eq("is_published", true)
      .eq("slug", slugCand)
      .maybeSingle();
    if (bySlug2?.slug && bySlug2?.title) {
      return { ok: true, scope: { kind: "sermon", sermon_slug: bySlug2.slug }, sermon_title: bySlug2.title, sermon_slug: bySlug2.slug };
    }
  }

  // 3) Titre fragment unique.
  const resolved = await resolveUniqueSermonSlugByTitle(admin, raw);
  if (resolved) {
    const { data: row } = await admin
      .from("sermons")
      .select("slug, title")
      .eq("is_published", true)
      .eq("slug", resolved)
      .maybeSingle();
    return { ok: true, scope: { kind: "sermon", sermon_slug: resolved }, sermon_title: row?.title ?? null, sermon_slug: resolved };
  }

  // 4) Fallback pragmatique : premier sermon publié correspondant au fragment de titre.
  const { data: byTitle } = await admin
    .from("sermons")
    .select("slug, title")
    .eq("is_published", true)
    .ilike("title", `%${raw}%`)
    .order("preached_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byTitle?.slug && byTitle?.title) {
    return { ok: true, scope: { kind: "sermon", sermon_slug: byTitle.slug }, sermon_title: byTitle.title, sermon_slug: byTitle.slug };
  }

  return { ok: true, scope: { kind: "library" }, sermon_title: null, sermon_slug: null };
}

export async function tool_get_paragraph_by_number(
  admin: SupabaseClient,
  args: { sermon_slug?: string; title_or_slug?: string; paragraph_number: number; query: string; offset?: number; page_size?: number; conversation_id: string },
): Promise<RetrievalOrchestratorResult> {
  let slug = (args.sermon_slug ?? "").trim();
  const titleOrSlug = (args.title_or_slug ?? "").trim();
  const n = Math.floor(Number(args.paragraph_number));
  const query = (args.query ?? "").trim();
  const conversationId = (args.conversation_id ?? "").trim();
  if (!slug && titleOrSlug) {
    const resolvedSlug = await resolveSermonSlugFromHint(admin, titleOrSlug, query);
    if (resolvedSlug) slug = resolvedSlug;
  }
  const scope: RetrievalScope = slug ? { kind: "sermon", sermon_slug: slug } : { kind: "library" };
  const pageSize = args.page_size ?? 20;
  const offset = args.offset ?? 0;
  if (!slug || !Number.isFinite(n) || n < 1) {
    return { ok: true, results: [], total_count: 0, scope, next_offset: null, offset: Math.max(0, offset), page_size: Math.max(1, Math.min(50, pageSize)), has_more: false };
  }
  const c = await fetchSingleParagraphCandidate(admin, slug, n);
  if (!c) {
    const fallbackSlug = await resolveSermonSlugFromHint(admin, titleOrSlug || slug, query);
    if (fallbackSlug && fallbackSlug !== slug) {
      const c2 = await fetchSingleParagraphCandidate(admin, fallbackSlug, n);
      if (c2) {
        const hit2 = await enrichWithNeighbors(admin, c2, {
          source: "chat",
          query,
          conversationId,
          offset: 0,
          pageSize: 1,
          nextOffset: null,
          hasMore: false,
          totalCount: 1,
        });
        return { ok: true, results: [hit2], total_count: 1, scope: { kind: "sermon", sermon_slug: fallbackSlug }, next_offset: null, offset: 0, page_size: 1, has_more: false };
      }
    }
    return { ok: true, results: [], total_count: 0, scope, next_offset: null, offset: Math.max(0, offset), page_size: Math.max(1, Math.min(50, pageSize)), has_more: false };
  }
  const hit = await enrichWithNeighbors(admin, c, {
    source: "chat",
    query,
    conversationId,
    offset: 0,
    pageSize: 1,
    nextOffset: null,
    hasMore: false,
    totalCount: 1,
  });
  return { ok: true, results: [hit], total_count: 1, scope, next_offset: null, offset: 0, page_size: 1, has_more: false };
}

export async function tool_search_paragraphs_global(
  admin: SupabaseClient,
  args: { query: string; offset?: number; page_size?: number; conversation_id: string },
): Promise<RetrievalOrchestratorResult> {
  const query = (args.query ?? "").trim();
  const offset = args.offset ?? 0;
  const pageSize = args.page_size ?? 20;
  const conversationId = (args.conversation_id ?? "").trim();
  const scope: RetrievalScope = { kind: "library" };
  if (!query) {
    return { ok: true, results: [], total_count: 0, scope, next_offset: null, offset: Math.max(0, offset), page_size: Math.max(1, Math.min(50, pageSize)), has_more: false };
  }
  const candidates = await fetchSermonSearchCandidates(admin, query);
  const pg = pageSlice(candidates, offset, pageSize);
  const results = await Promise.all(
    pg.page.map((c) =>
      enrichWithNeighbors(admin, c, {
        source: "chat",
        query,
        conversationId,
        offset: pg.offset,
        pageSize: pg.pageSize,
        nextOffset: pg.nextOffset,
        hasMore: pg.hasMore,
        totalCount: pg.totalCount,
      }),
    ),
  );
  return {
    ok: true,
    results,
    total_count: pg.totalCount,
    scope,
    next_offset: pg.nextOffset,
    offset: pg.offset,
    page_size: pg.pageSize,
    has_more: pg.hasMore,
  };
}

export async function tool_search_paragraphs_in_sermon(
  admin: SupabaseClient,
  args: { sermon_slug?: string; title_or_slug?: string; query: string; offset?: number; page_size?: number; conversation_id: string },
): Promise<RetrievalOrchestratorResult> {
  let slug = (args.sermon_slug ?? "").trim();
  const titleOrSlug = (args.title_or_slug ?? "").trim();
  const query = (args.query ?? "").trim();
  const offset = args.offset ?? 0;
  const pageSize = args.page_size ?? 20;
  const conversationId = (args.conversation_id ?? "").trim();
  if (!slug && titleOrSlug) {
    const resolvedSlug = await resolveSermonSlugFromHint(admin, titleOrSlug, query);
    if (resolvedSlug) slug = resolvedSlug;
  }
  const scope: RetrievalScope = slug ? { kind: "sermon", sermon_slug: slug } : { kind: "library" };
  if (!slug || !query) {
    return { ok: true, results: [], total_count: 0, scope, next_offset: null, offset: Math.max(0, offset), page_size: Math.max(1, Math.min(50, pageSize)), has_more: false };
  }
  const candidates = (await fetchSermonSearchCandidates(admin, query)).filter((c) => c.slug === slug);
  if (candidates.length === 0) {
    // Si le scope choisi n'a rien, on élargit pour éviter un faux négatif bloquant.
    return tool_search_paragraphs_global(admin, { query, offset, page_size: pageSize, conversation_id: conversationId });
  }
  const pg = pageSlice(candidates, offset, pageSize);
  const results = await Promise.all(
    pg.page.map((c) =>
      enrichWithNeighbors(admin, c, {
        source: "chat",
        query,
        conversationId,
        offset: pg.offset,
        pageSize: pg.pageSize,
        nextOffset: pg.nextOffset,
        hasMore: pg.hasMore,
        totalCount: pg.totalCount,
      }),
    ),
  );
  return {
    ok: true,
    results,
    total_count: pg.totalCount,
    scope,
    next_offset: pg.nextOffset,
    offset: pg.offset,
    page_size: pg.pageSize,
    has_more: pg.hasMore,
  };
}

export async function tool_get_neighbor_paragraphs(
  admin: SupabaseClient,
  args: { sermon_slug: string; paragraph_number: number },
): Promise<{ ok: true; sermon_slug: string; paragraph_number: number; prev_paragraph_number: number | null; prev_paragraph_text: string | null; next_paragraph_number: number | null; next_paragraph_text: string | null }> {
  const slug = (args.sermon_slug ?? "").trim();
  const n = Math.floor(Number(args.paragraph_number));
  const neighbors = await fetchNeighborParagraphs(admin, slug, n);
  return { ok: true, sermon_slug: slug, paragraph_number: n, ...neighbors };
}

export async function tool_continue_last_scope(
  admin: SupabaseClient,
  args: { last_scope: RetrievalScope; last_query: string; next_offset: number; page_size?: number; conversation_id: string },
): Promise<RetrievalOrchestratorResult> {
  const scope = args.last_scope ?? { kind: "library" };
  const query = (args.last_query ?? "").trim();
  const offset = Math.max(0, Math.floor(Number(args.next_offset ?? 0)));
  const pageSize = args.page_size ?? 20;
  const conversationId = (args.conversation_id ?? "").trim();
  if (!query) {
    return { ok: true, results: [], total_count: 0, scope, next_offset: null, offset, page_size: Math.max(1, Math.min(50, pageSize)), has_more: false };
  }
  if (scope.kind === "sermon") {
    return tool_search_paragraphs_in_sermon(admin, { sermon_slug: scope.sermon_slug, query, offset, page_size: pageSize, conversation_id: conversationId });
  }
  return tool_search_paragraphs_global(admin, { query, offset, page_size: pageSize, conversation_id: conversationId });
}

