import type { SupabaseClient } from "@supabase/supabase-js";
import type { SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";
import type { ConcordanceHit } from "@/lib/sermons/concordance-types";

type RpcSearchRow = {
  slug: string | null;
  title: string | null;
  year: number | null;
  preached_on: string | null;
  location: string | null;
  paragraph_number: number | null;
  paragraph_text: string | null;
  prev_paragraph_number: number | null;
  prev_paragraph_text: string | null;
  next_paragraph_number: number | null;
  next_paragraph_text: string | null;
  relevance_tier: number | null;
  search_rank: number | null;
  total_count: number | null;
};

export type FastSermonSearchOptions = {
  queries?: string[];
  sermonSlug?: string | null;
  titleFilter?: string | null;
  year?: number | null;
  locationFilter?: string | null;
  limit?: number;
  offset?: number;
};

export type FastSermonSearchResult = {
  rows: RpcSearchRow[];
  totalCount: number;
};

function cleanQueries(queries: string[] | undefined): string[] | null {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of queries ?? []) {
    const t = q.trim();
    if (t.length < 2) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out.length > 0 ? out : null;
}

export async function fetchFastSermonSearch(
  client: SupabaseClient,
  query: string,
  opts: FastSermonSearchOptions = {},
): Promise<FastSermonSearchResult | null> {
  const q = query.trim();
  if (q.length < 2) return { rows: [], totalCount: 0 };

  const { data, error } = await client.rpc("moboko_search_sermon_paragraphs", {
    p_query: q,
    p_queries: cleanQueries(opts.queries),
    p_sermon_slug: opts.sermonSlug?.trim() || null,
    p_title_filter: opts.titleFilter?.trim() || null,
    p_year: opts.year ?? null,
    p_location_filter: opts.locationFilter?.trim() || null,
    p_limit: Math.max(1, Math.min(100, opts.limit ?? 20)),
    p_offset: Math.max(0, opts.offset ?? 0),
  });

  if (error) {
    if (process.env.MOBOKO_SEARCH_DEBUG === "1") {
      console.warn("[sermon-search] fast_rpc_failed", {
        code: error.code,
        message: error.message,
      });
    }
    return null;
  }

  const rows = ((data ?? []) as RpcSearchRow[]).filter(
    (row) =>
      typeof row.slug === "string" &&
      typeof row.title === "string" &&
      typeof row.paragraph_number === "number" &&
      typeof row.paragraph_text === "string",
  );
  const firstTotal = rows.find((row) => typeof row.total_count === "number")?.total_count;
  return {
    rows,
    totalCount: typeof firstTotal === "number" ? firstTotal : rows.length,
  };
}

export function fastRowsToCandidates(rows: RpcSearchRow[]): SermonParagraphCandidate[] {
  return rows
    .filter(
      (row) =>
        typeof row.slug === "string" &&
        typeof row.title === "string" &&
        typeof row.paragraph_number === "number" &&
        typeof row.paragraph_text === "string",
    )
    .map((row) => ({
      slug: row.slug as string,
      title: row.title as string,
      year: row.year ?? null,
      preached_on: row.preached_on ?? null,
      location: row.location ?? null,
      paragraph_number: row.paragraph_number as number,
      paragraph_text: row.paragraph_text as string,
      prev_paragraph_number: row.prev_paragraph_number ?? null,
      prev_paragraph_text: row.prev_paragraph_text ?? null,
      next_paragraph_number: row.next_paragraph_number ?? null,
      next_paragraph_text: row.next_paragraph_text ?? null,
    }));
}

export function fastRowsToConcordanceHits(
  rows: RpcSearchRow[],
  opts: {
    query: string;
    source: "chat" | "sermons-search";
    offset: number;
    pageSize: number;
    totalCount?: number;
  },
): ConcordanceHit[] {
  const total = opts.totalCount ?? rows.length;
  const end = opts.offset + rows.length;
  const hasMore = end < total;
  return rows
    .filter(
      (row) =>
        typeof row.slug === "string" &&
        typeof row.title === "string" &&
        typeof row.paragraph_number === "number" &&
        typeof row.paragraph_text === "string",
    )
    .map((row) => ({
      slug: row.slug as string,
      title: row.title as string,
      location: row.location ?? null,
      date: row.preached_on ?? (row.year != null ? String(row.year) : null),
      paragraph_number: row.paragraph_number as number,
      paragraph_text: row.paragraph_text as string,
      prev_paragraph_number: row.prev_paragraph_number ?? null,
      prev_paragraph_text: row.prev_paragraph_text ?? null,
      next_paragraph_number: row.next_paragraph_number ?? null,
      next_paragraph_text: row.next_paragraph_text ?? null,
      _source: opts.source,
      _query: opts.query,
      _offset: opts.offset,
      _page_size: opts.pageSize,
      _next_offset: hasMore ? end : null,
      _has_more: hasMore,
      _total_count: total,
    }));
}
