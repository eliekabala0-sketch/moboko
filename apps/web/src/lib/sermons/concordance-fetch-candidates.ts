import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchSermonSearchCandidates,
  type SermonParagraphCandidate,
} from "@/lib/sermons/ai-sermon-search-server";
import { fetchSingleParagraphCandidate } from "@/lib/sermons/retrieval-direct";
import type { SemanticIntent } from "@/lib/sermons/semantic-intent";

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

  const maxQueries = profile === "library" ? 28 : 26;
  const MAX_CANDIDATES = profile === "library" ? 1200 : 900;
  const firstWave = profile === "library" ? 8 : 6;
  const secondStart = profile === "library" ? 8 : 6;
  const secondEnd = profile === "library" ? 18 : 16;
  const break1 = profile === "library" ? 380 : 320;
  const break2 = profile === "library" ? 900 : 700;
  const break1b = profile === "library" ? 800 : 620;
  const break2b = profile === "library" ? 900 : 700;

  const queries = candidatesRaw.slice(0, maxQueries);
  const byKey = new Map<string, SermonParagraphCandidate>();
  const collect = async (qStr: string) => {
    const rows = await fetchSermonSearchCandidates(admin, qStr);
    for (const c of rows) {
      if (restrict && c.slug !== restrict) continue;
      const k = `${c.slug}:${c.paragraph_number}`;
      if (!byKey.has(k)) byKey.set(k, c);
      if (byKey.size >= MAX_CANDIDATES) break;
    }
  };

  for (const qStr of queries.slice(0, firstWave)) {
    await collect(qStr);
    if (byKey.size >= break1) break;
  }
  if (byKey.size < break1b) {
    for (const qStr of queries.slice(secondStart, secondEnd)) {
      await collect(qStr);
      if (byKey.size >= break2) break;
    }
  }
  if (byKey.size < break2b) {
    const broad = dedupeQueries([
      semantic?.intent ?? "",
      semantic?.topic ?? "",
      ...(semantic?.concepts ?? []).slice(0, 5),
    ])
      .filter((x) => x.length >= 4 && !isShallowBaitOnly(x, bait))
      .join(" ");
    if (broad.trim().length >= 4 && !isShallowBaitOnly(broad, bait)) await collect(broad);
    for (const qStr of queries.slice(secondEnd)) {
      await collect(qStr);
      if (byKey.size >= MAX_CANDIDATES) break;
    }
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
  const score = (c: SermonParagraphCandidate) => {
    const t = c.paragraph_text.toLowerCase();
    let s = 0;
    if (semantic?.search_mode === "exact_quote_search" && semantic.quoted_phrase) {
      if (t.includes(semantic.quoted_phrase.toLowerCase())) s += 12;
    }
    if (semantic?.topic && t.includes(semantic.topic.toLowerCase())) s += 2;
    return s;
  };
  out.sort((a, b) => score(b) - score(a));
  return out.slice(0, MAX_CANDIDATES);
}
