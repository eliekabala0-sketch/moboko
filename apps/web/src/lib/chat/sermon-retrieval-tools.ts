import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetrievalOrchestratorResult, RetrievalScope } from "@/lib/chat/sermon-retrieval-types";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { fetchSingleParagraphCandidate, resolveUniqueSermonSlugByTitle } from "@/lib/sermons/retrieval-direct";
import { fetchSermonSearchCandidates } from "@/lib/sermons/ai-sermon-search-server";
import type { SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";

function normLoose(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normLoose(s)
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length >= 4);
}

function rankCandidatesByQuery(candidates: SermonParagraphCandidate[], query: string): SermonParagraphCandidate[] {
  const qTokens = tokenize(query).slice(0, 10);
  if (qTokens.length === 0) return candidates;
  const scored = candidates.map((c) => {
    const text = normLoose(c.paragraph_text);
    const title = normLoose(c.title);
    let score = 0;
    let matches = 0;
    for (const tk of qTokens) {
      if (text.includes(tk)) {
        score += 3;
        matches += 1;
      }
      if (title.includes(tk)) score += 1;
    }
    // Favor phrase proximity for longer clues.
    const qNorm = normLoose(query);
    if (qNorm.length >= 20 && text.includes(qNorm)) score += 12;
    return { c, score, matches };
  });
  const strict = scored.filter((x) => x.matches >= 2);
  const pool = strict.length > 0 ? strict : scored;
  pool.sort((a, b) => b.score - a.score);
  return pool.map((x) => x.c);
}

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

type SermonRow = { slug: string; title: string };

function scoreSermonHintMatch(hintRaw: string, slug: string, title: string): number {
  const hint = hintRaw.trim();
  if (!hint || !slug) return 0;
  const nh = normLoose(hint);
  const nt = normLoose(title);
  const slugAsText = normLoose(slug.replace(/-/g, " "));
  let score = 0;
  if (nh.length >= 12 && nt.includes(nh)) score += 200;
  if (nh.length >= 12 && nh.includes(nt) && nt.length >= 20) score += 120;
  const hintSlugLike = hint.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (hintSlugLike && slug === hint) score += 250;
  if (hintSlugLike && slug === hintSlugLike) score += 250;
  if (hintSlugLike && slug.startsWith(hintSlugLike)) score += 60;
  if (hintSlugLike && nh.length >= 8 && slugAsText.includes(nh)) score += 35;
  for (const tk of tokenize(hint).slice(0, 12)) {
    if (nt.includes(tk)) score += 4;
    if (slug.includes(tk)) score += 2;
  }
  // Désambiguïser "La Brèche (sept âges…)" vs "Se tenir à la brèche" : titres longs qui mentionnent sept/sceaux/âges.
  if (nh.includes("breche") && nh.includes("sept") && (nh.includes("sceau") || nh.includes("age"))) {
    if (nt.includes("sept") && (nt.includes("sceau") || nt.includes("sceaux"))) score += 80;
    if (nt.includes("se tenir") || nt.includes("tenir a la breche")) score -= 100;
  }
  return score;
}

function pickSlugWithPreferredTieBreak(
  scored: { slug: string; score: number }[],
  preferredSlug: string | null | undefined,
): string | null {
  if (scored.length === 0) return null;
  const max = Math.max(...scored.map((s) => s.score));
  if (max <= 0) return null;
  const eps = 12;
  const top = scored.filter((s) => s.score >= max - eps);
  const pref = preferredSlug?.trim();
  if (pref && top.some((s) => s.slug === pref)) return pref;
  top.sort((a, b) => b.score - a.score);
  return top[0]?.slug ?? null;
}

async function gatherSermonRowsForHint(admin: SupabaseClient, hint: string, queryHint: string): Promise<Map<string, SermonRow>> {
  const out = new Map<string, SermonRow>();
  const addRows = (rows: unknown[] | null | undefined) => {
    for (const row of rows ?? []) {
      const slug = String((row as { slug?: string }).slug ?? "").trim();
      const title = String((row as { title?: string }).title ?? "").trim();
      if (slug && title) out.set(slug, { slug, title });
    }
  };

  const hintSlugLike = hint.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (hintSlugLike) {
    const { data: bySlugExact } = await admin.from("sermons").select("slug, title").eq("is_published", true).eq("slug", hint).maybeSingle();
    if (bySlugExact?.slug && bySlugExact.title) addRows([bySlugExact]);
    const { data: bySlugNorm } = await admin
      .from("sermons")
      .select("slug, title")
      .eq("is_published", true)
      .eq("slug", hintSlugLike)
      .maybeSingle();
    if (bySlugNorm?.slug && bySlugNorm.title) addRows([bySlugNorm]);
    const { data: bySlugPrefix } = await admin
      .from("sermons")
      .select("slug, title")
      .eq("is_published", true)
      .ilike("slug", `${hintSlugLike}%`)
      .limit(60);
    addRows(bySlugPrefix ?? []);
  }

  const nh = normLoose(hint);
  if (nh.includes("breche") && (nh.includes("sept") || nh.includes("sceau") || nh.includes("age"))) {
    const { data: narrow } = await admin
      .from("sermons")
      .select("slug, title")
      .eq("is_published", true)
      .ilike("title", "%breche%")
      .ilike("title", "%sept%")
      .limit(40);
    addRows(narrow ?? []);
  }

  const tokens = tokenize(hint).slice(0, 8);
  if (tokens.length > 0) {
    const orExpr = tokens.map((t) => `title.ilike.%${t}%`).join(",");
    const { data: rows } = await admin.from("sermons").select("slug, title").eq("is_published", true).or(orExpr).limit(120);
    addRows(rows ?? []);
  }

  const seeded = await fetchSermonSearchCandidates(admin, `${hint} ${queryHint}`.trim());
  for (const c of seeded.slice(0, 80)) {
    if (c.slug && c.title) out.set(c.slug, { slug: c.slug, title: c.title });
  }

  return out;
}

async function resolveSermonSlugFromHint(
  admin: SupabaseClient,
  titleOrSlug: string,
  queryHint: string,
  preferredSlug?: string | null,
): Promise<string | null> {
  const hint = titleOrSlug.trim();
  if (!hint) return null;

  const rows = await gatherSermonRowsForHint(admin, hint, queryHint);
  const resolved = await tool_find_sermon_by_title_or_slug(admin, { title_or_slug: titleOrSlug });
  if (resolved.scope.kind === "sermon" && resolved.scope.sermon_slug) {
    const t = (resolved.sermon_title ?? "").trim();
    if (t) rows.set(resolved.scope.sermon_slug, { slug: resolved.scope.sermon_slug, title: t });
  }
  if (rows.size === 0) return null;

  const scored = [...rows.values()].map((row) => ({
    slug: row.slug,
    score: scoreSermonHintMatch(hint, row.slug, row.title),
  }));

  return pickSlugWithPreferredTieBreak(scored, preferredSlug);
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
  args: {
    sermon_slug?: string;
    title_or_slug?: string;
    paragraph_number: number;
    query: string;
    offset?: number;
    page_size?: number;
    conversation_id: string;
    lock_sermon_slug?: boolean;
    preferred_sermon_slug?: string | null;
  },
): Promise<RetrievalOrchestratorResult> {
  let slug = (args.sermon_slug ?? "").trim();
  const titleOrSlug = (args.title_or_slug ?? "").trim();
  const locked = Boolean(args.lock_sermon_slug) && Boolean(slug);
  const preferred = (args.preferred_sermon_slug ?? "").trim() || null;
  const n = Math.floor(Number(args.paragraph_number));
  const query = (args.query ?? "").trim();
  const conversationId = (args.conversation_id ?? "").trim();
  if (locked) {
    const { data: row } = await admin.from("sermons").select("slug").eq("is_published", true).eq("slug", slug).maybeSingle();
    if (!row?.slug) {
      const scope: RetrievalScope = { kind: "library" };
      return { ok: true, results: [], total_count: 0, scope, next_offset: null, offset: 0, page_size: 1, has_more: false };
    }
  } else {
    if (!slug && titleOrSlug) {
      const resolvedSlug = await resolveSermonSlugFromHint(admin, titleOrSlug, query, preferred);
      if (resolvedSlug) slug = resolvedSlug;
    }
    if (slug) {
      const resolvedFromSlugHint = await resolveSermonSlugFromHint(admin, slug, query, preferred);
      if (resolvedFromSlugHint) slug = resolvedFromSlugHint;
    }
  }
  const scope: RetrievalScope = slug ? { kind: "sermon", sermon_slug: slug } : { kind: "library" };
  const pageSize = args.page_size ?? 20;
  const offset = args.offset ?? 0;
  if (!slug || !Number.isFinite(n) || n < 1) {
    return { ok: true, results: [], total_count: 0, scope, next_offset: null, offset: Math.max(0, offset), page_size: Math.max(1, Math.min(50, pageSize)), has_more: false };
  }
  const c = await fetchSingleParagraphCandidate(admin, slug, n);
  if (!c) {
    if (!locked && titleOrSlug) {
      const fallbackSlug = await resolveSermonSlugFromHint(admin, titleOrSlug, query, preferred);
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
  const ranked = rankCandidatesByQuery(candidates, query);
  const pg = pageSlice(ranked, offset, pageSize);
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
  args: {
    sermon_slug?: string;
    title_or_slug?: string;
    query: string;
    offset?: number;
    page_size?: number;
    conversation_id: string;
    lock_sermon_slug?: boolean;
    preferred_sermon_slug?: string | null;
  },
): Promise<RetrievalOrchestratorResult> {
  let slug = (args.sermon_slug ?? "").trim();
  const titleOrSlug = (args.title_or_slug ?? "").trim();
  const query = (args.query ?? "").trim();
  const offset = args.offset ?? 0;
  const pageSize = args.page_size ?? 20;
  const conversationId = (args.conversation_id ?? "").trim();
  const locked = Boolean(args.lock_sermon_slug) && Boolean(slug);
  const preferred = (args.preferred_sermon_slug ?? "").trim() || null;
  if (locked) {
    const { data: row } = await admin.from("sermons").select("slug").eq("is_published", true).eq("slug", slug).maybeSingle();
    if (!row?.slug) slug = "";
  } else {
    if (!slug && titleOrSlug) {
      const resolvedSlug = await resolveSermonSlugFromHint(admin, titleOrSlug, query, preferred);
      if (resolvedSlug) slug = resolvedSlug;
    }
    if (slug) {
      const canonicalSlug = await resolveSermonSlugFromHint(admin, slug, query, preferred);
      if (canonicalSlug) slug = canonicalSlug;
    }
  }
  const scope: RetrievalScope = slug ? { kind: "sermon", sermon_slug: slug } : { kind: "library" };
  if (!slug || !query) {
    return { ok: true, results: [], total_count: 0, scope, next_offset: null, offset: Math.max(0, offset), page_size: Math.max(1, Math.min(50, pageSize)), has_more: false };
  }
  const candidates = (await fetchSermonSearchCandidates(admin, query)).filter((c) => c.slug === slug);
  const ranked = rankCandidatesByQuery(candidates, query);
  const pg = pageSlice(ranked, offset, pageSize);
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
    return tool_search_paragraphs_in_sermon(admin, {
      sermon_slug: scope.sermon_slug,
      query,
      offset,
      page_size: pageSize,
      conversation_id: conversationId,
      lock_sermon_slug: true,
    });
  }
  return tool_search_paragraphs_global(admin, { query, offset, page_size: pageSize, conversation_id: conversationId });
}

