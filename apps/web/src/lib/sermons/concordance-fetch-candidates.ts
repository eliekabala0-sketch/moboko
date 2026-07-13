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

const MINISTRY_ALIASES = [
  "predicateur",
  "predication",
  "ministre",
  "ministere",
  "pasteur",
  "evangeliste",
  "homme de dieu",
  "serviteur de dieu",
  "ancien",
  "surveillant",
  "messager",
  "missionnaire",
  "conducteur",
  "frere dans le ministere",
];

const MARRIAGE_FAMILY_ALIASES = [
  "mariage",
  "marie",
  "marier",
  "epouse",
  "femme",
  "mari",
  "foyer",
  "famil",
  "qualification",
  "conduite",
  "maison",
];

const ONE_FLESH_INTENT_ALIASES = [
  "une seule chair",
  "seule chair",
  "deux deviennent un",
  "deux deviennent une",
  "devenir une seule chair",
  "devenons une seule chair",
  "deviennent une seule chair",
  "deviennent un",
  "ne sont plus deux",
  "chair de ma chair",
  "union conjugale",
  "mari et femme unis",
  "epoux deviennent",
  "apres mariage",
  "homme et femme",
];

const ONE_FLESH_TEXT_ALIASES = [
  "une seule chair",
  "seule chair",
  "deux deviennent un",
  "deux deviendront un",
  "deux deviendraient un",
  "deux deviennent une",
  "deux devinrent un",
  "devenir un",
  "deviennent un",
  "deviendra un",
  "deviendraient un",
  "ne sont plus deux",
  "chair de ma chair",
  "os de mes os",
  "one flesh",
  "no more twain",
  "twain one",
];

const UNION_ALIASES = [
  "homme et femme",
  "mari et femme",
  "mari femme",
  "epoux",
  "epouse",
  "mari",
  "femme",
  "union",
  "unis",
  "unir",
  "conjugale",
];

const ONE_FLESH_EXCLUSIONS = [
  { key: "herode", aliases: ["herode", "herodias", "femme de son frere"] },
  { key: "ceremonie_mariage", aliases: ["ceremonie", "celebration", "noces", "service de mariage"] },
  { key: "divorce_seul", aliases: ["divorce", "repudiation"] },
];

function normalizedText(s: string) {
  return normQueryTokens(s).join(" ");
}

function hasAnyAlias(text: string, aliases: string[]) {
  return aliases.some((alias) => text.includes(alias));
}

function matchedAliases(text: string, aliases: string[]) {
  return aliases.filter((alias) => text.includes(alias));
}

function shouldUseStrictMinistryFilter(query: string, semantic: SemanticIntent | null) {
  const haystack = normalizedText(
    [
      query,
      semantic?.intent ?? "",
      semantic?.topic ?? "",
      semantic?.passage_brief ?? "",
      ...(semantic?.concepts ?? []),
      ...(semantic?.expansions ?? []),
      ...(semantic?.retrieval_phrases ?? []),
    ].join(" "),
  );
  return hasAnyAlias(haystack, MINISTRY_ALIASES) && hasAnyAlias(haystack, MARRIAGE_FAMILY_ALIASES);
}

function semanticHaystack(query: string, semantic: SemanticIntent | null) {
  return normalizedText(
    [
      query,
      semantic?.intent ?? "",
      semantic?.topic ?? "",
      semantic?.passage_brief ?? "",
      ...(semantic?.concepts ?? []),
      ...(semantic?.expansions ?? []),
      ...(semantic?.retrieval_phrases ?? []),
    ].join(" "),
  );
}

function shouldUseOneFleshFilter(query: string, semantic: SemanticIntent | null) {
  const queryOnly = normalizedText(query);
  if (!hasAnyAlias(queryOnly, ONE_FLESH_INTENT_ALIASES)) return false;
  return hasAnyAlias(semanticHaystack(query, semantic), ONE_FLESH_INTENT_ALIASES);
}

export function shouldKeepStrictSemanticEmpty(query: string, semantic: SemanticIntent | null) {
  return shouldUseOneFleshFilter(query, semantic) || shouldUseStrictMinistryFilter(query, semantic);
}

function auditOneFleshCandidate(candidate: SermonParagraphCandidate) {
  const text = normalizedText(`${candidate.title ?? ""} ${candidate.paragraph_text ?? ""}`);
  const marriage = matchedAliases(text, MARRIAGE_FAMILY_ALIASES);
  const union = matchedAliases(text, UNION_ALIASES);
  const oneFlesh = matchedAliases(text, ONE_FLESH_TEXT_ALIASES);
  const matched = Array.from(new Set([...marriage.slice(0, 3), ...union.slice(0, 3), ...oneFlesh.slice(0, 4)]));

  let exclusion: string | null = null;
  for (const ex of ONE_FLESH_EXCLUSIONS) {
    if (hasAnyAlias(text, ex.aliases)) {
      exclusion = ex.key;
      break;
    }
  }

  const hasMarriage = marriage.length > 0;
  const hasUnion = union.length > 0;
  const hasOneFlesh = oneFlesh.length > 0;
  const score =
    (hasMarriage ? 30 : 0) +
    (hasUnion ? 30 : 0) +
    (hasOneFlesh ? 45 : 0) +
    Math.min(15, matched.length * 3) -
    (exclusion ? 25 : 0);
  const finalSelected = hasMarriage && hasUnion && hasOneFlesh && !(exclusion && score < 95);

  return {
    matched_required_concepts: matched,
    semantic_score: score,
    exclusion_triggered: exclusion,
    final_selected: finalSelected,
  };
}

function applyStrictSemanticFilter(
  candidates: SermonParagraphCandidate[],
  query: string,
  semantic: SemanticIntent | null,
) {
  if (shouldUseOneFleshFilter(query, semantic)) {
    const audited = candidates.map((candidate) => ({
      candidate,
      audit: auditOneFleshCandidate(candidate),
    }));
    const selected = audited
      .filter((x) => x.audit.final_selected)
      .sort((a, b) => b.audit.semantic_score - a.audit.semantic_score)
      .map(({ candidate, audit }) => ({ ...candidate, relevance_audit: audit }));
    if (process.env.MOBOKO_ASSISTANT_AI_DEBUG === "1") {
      for (const { candidate, audit } of audited.slice(0, 120)) {
        console.log("[assistant-ai] relevance_audit", {
          paragraph_number: candidate.paragraph_number,
          sermon_slug: candidate.slug,
          ...audit,
        });
      }
    }
    return selected;
  }
  if (!shouldUseStrictMinistryFilter(query, semantic)) return candidates;
  const strict = candidates.filter((candidate) => {
    const text = normalizedText(`${candidate.title ?? ""} ${candidate.paragraph_text ?? ""}`);
    return hasAnyAlias(text, MINISTRY_ALIASES) && hasAnyAlias(text, MARRIAGE_FAMILY_ALIASES);
  });
  return strict;
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
  out = applyStrictSemanticFilter(out, query, semantic);
  return sortSermonOccurrencesOldestFirst(out).slice(0, MAX_CANDIDATES);
}
