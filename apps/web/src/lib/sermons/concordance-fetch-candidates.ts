import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchSermonSearchCandidates,
  type SermonParagraphCandidate,
} from "@/lib/sermons/ai-sermon-search-server";
import { fetchSingleParagraphCandidate } from "@/lib/sermons/retrieval-direct";
import type { SemanticIntent } from "@/lib/sermons/semantic-intent";
import { sortSermonOccurrencesOldestFirst } from "@/lib/sermons/source-order";

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

export type ConcordanceFetchProfile = "chat" | "library";

/**
 * Récupère les candidats paragraphes selon le plan sémantique (FTS multi-vagues).
 * Lookup direct si exact_paragraph_lookup + slug + numéro.
 */
export async function fetchConcordanceSemanticCandidates(
  admin: SupabaseClient,
  query: string,
  semantic: SemanticIntent | null,
  profile: ConcordanceFetchProfile,
): Promise<SermonParagraphCandidate[]> {
  if (
    semantic?.search_mode === "exact_paragraph_lookup" &&
    semantic.restrict_sermon_slug &&
    semantic.paragraph_exact != null
  ) {
    const c = await fetchSingleParagraphCandidate(
      admin,
      semantic.restrict_sermon_slug,
      semantic.paragraph_exact,
    );
    return c ? [c] : [];
  }

  const bait = new Set(semantic?.avoid_lexical_bait ?? []);
  const restrict = semantic?.restrict_sermon_slug?.trim() ?? null;
  const quoted = semantic?.quoted_phrase ? [semantic.quoted_phrase] : [];
  const titleThenTopic =
    semantic?.search_mode === "sermon_title_then_topic_search" && semantic?.sermon_hint
      ? [`${semantic.sermon_hint} ${semantic.topic || query}`]
      : [];

  const candidatesRaw = dedupeQueries([
    ...(semantic?.retrieval_phrases ?? []),
    semantic?.intent ?? "",
    semantic?.topic ?? "",
    ...quoted,
    ...titleThenTopic,
    ...(semantic?.expansions ?? []),
    ...(semantic?.concepts ?? []),
    query,
  ]).filter((qStr) => !isShallowBaitOnly(qStr, bait));

  const MAX_CANDIDATES = profile === "library" ? 1200 : 900;
  const maxQueries = profile === "library" ? 12 : 10;
  const queries = candidatesRaw.slice(0, maxQueries);
  const byKey = new Map<string, SermonParagraphCandidate>();

  const primary = queries[0] ?? query;
  const broad = dedupeQueries([
    semantic?.intent ?? "",
    semantic?.topic ?? "",
    ...(semantic?.concepts ?? []).slice(0, 5),
  ])
    .filter((x) => x.length >= 4 && !isShallowBaitOnly(x, bait))
    .join(" ");
  const packedQueries = broad ? [...queries, broad] : queries;
  const rows = await fetchSermonSearchCandidates(admin, primary, {
    queries: packedQueries.slice(1),
    sermonSlug: restrict,
    yearFrom: semantic?.year_from ?? null,
    yearTo: semantic?.year_to ?? null,
    limit: MAX_CANDIDATES,
  });

  for (const c of rows) {
    if (restrict && c.slug !== restrict) continue;
    const k = `${c.slug}:${c.paragraph_number}`;
    if (!byKey.has(k)) byKey.set(k, c);
    if (byKey.size >= MAX_CANDIDATES) break;
  }

  let out = Array.from(byKey.values());
  if (restrict) {
    out = out.filter((c) => c.slug === restrict);
  }
  if (semantic?.year_from != null || semantic?.year_to != null) {
    const minY = semantic.year_from ?? 1900;
    const maxY = semantic.year_to ?? 2100;
    out = out.filter((c) => c.year == null || (c.year >= minY && c.year <= maxY));
  }
  return sortSermonOccurrencesOldestFirst(out).slice(0, MAX_CANDIDATES);
}
