import type { SupabaseClient } from "@supabase/supabase-js";
import type { SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";
import type { SemanticIntent } from "@/lib/sermons/semantic-intent";
import {
  fetchSingleParagraphCandidate,
  resolveUniqueSermonSlugByTitle,
} from "@/lib/sermons/retrieval-direct";

export type DeterministicRetrievalResult = {
  semantic: SemanticIntent;
  /** null → enchaîner sur fetch FTS habituel avec ce plan ; non-null → candidats déjà calculés */
  preFetchedCandidates: SermonParagraphCandidate[] | null;
  skipRankingLlm: boolean;
};

const SLUG_IN_PATH = /\/sermons\/([a-z0-9][-a-z0-9]*)(?:\/|\?|#|\s|$)/i;
const SLUG_TOKEN = /\bslug\s*[:=]\s*([a-z0-9][-a-z0-9]*)\b/i;

function extractParagraphNumber(q: string): number | null {
  const s = q.trim();
  const patterns: RegExp[] = [
    /§\s*(\d{1,5})\b/i,
    /\bparagraphe\s+(\d{1,5})\b/i,
    /\bparagraph\s+(\d{1,5})\b/i,
    /\bp\.?\s*(\d{1,5})\b/i,
    /\bpara\.?\s*(\d{1,5})\b/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 50_000) return n;
    }
  }
  return null;
}

function extractSlugFromQuery(q: string): string | null {
  const m1 = q.match(SLUG_IN_PATH);
  if (m1?.[1]) return m1[1].toLowerCase();
  const m2 = q.match(SLUG_TOKEN);
  if (m2?.[1]) return m2[1].toLowerCase();
  return null;
}

/** Guillemets « » ou " " pour un titre de sermon. */
function extractQuotedTitleFragment(q: string): string | null {
  const m1 = q.match(/[«"]([^»"]{4,120})[»"]/);
  if (m1?.[1]) return m1[1].trim();
  const m2 = q.match(/\bsermon\s+(?:intitulé\s+|titré\s+)?["']([^"']{4,120})["']/i);
  if (m2?.[1]) return m2[1].trim();
  return null;
}

function baseDeterministicSemantic(partial: Partial<SemanticIntent>): SemanticIntent {
  return {
    search_mode: partial.search_mode ?? "theme_search",
    user_need: partial.user_need ?? "citation_list",
    intent: partial.intent ?? "",
    topic: partial.topic ?? "",
    concepts: partial.concepts ?? [],
    expansions: partial.expansions ?? [],
    content_types: partial.content_types ?? [],
    quoted_phrase: partial.quoted_phrase ?? null,
    sermon_hint: partial.sermon_hint ?? null,
    year_from: partial.year_from ?? null,
    year_to: partial.year_to ?? null,
    maybe_meant: partial.maybe_meant ?? null,
    retrieval_phrases: partial.retrieval_phrases ?? [],
    avoid_lexical_bait: partial.avoid_lexical_bait ?? [],
    passage_brief: partial.passage_brief ?? "",
    restrict_sermon_slug: partial.restrict_sermon_slug ?? null,
    follow_up_continuity: partial.follow_up_continuity ?? false,
    paragraph_exact: partial.paragraph_exact ?? null,
    confidence: partial.confidence ?? 1,
    routing_source: "deterministic",
  };
}

/**
 * Cas structurés évidents : aucun appel IA de compréhension.
 * Retourne null → déléguer au retrieval agent.
 */
export async function tryDeterministicRetrieval(
  admin: SupabaseClient,
  query: string,
  opts: { primarySlug: string | null },
): Promise<DeterministicRetrievalResult | null> {
  const q = query.trim();
  if (q.length < 2) return null;

  const para = extractParagraphNumber(q);
  let slug = extractSlugFromQuery(q) ?? opts.primarySlug;

  if (para != null) {
    if (!slug) {
      const titleFrag = extractQuotedTitleFragment(q);
      if (titleFrag) {
        slug = await resolveUniqueSermonSlugByTitle(admin, titleFrag);
      }
    }
    if (slug) {
      const c = await fetchSingleParagraphCandidate(admin, slug, para);
      if (c) {
        return {
          semantic: baseDeterministicSemantic({
            search_mode: "exact_paragraph_lookup",
            intent: `Paragraphe §${para} (lookup direct)`,
            topic: "",
            passage_brief: "Paragraphe demandé explicitement par numéro.",
            restrict_sermon_slug: slug,
            paragraph_exact: para,
            retrieval_phrases: [],
            content_types: ["exact_paragraph"],
          }),
          preFetchedCandidates: [c],
          skipRankingLlm: true,
        };
      }
    }
  }

  const quoted = extractQuotedTitleFragment(q);
  if (quoted && !para) {
    const resolved = await resolveUniqueSermonSlugByTitle(admin, quoted);
    if (resolved) {
      const stripped = q
        .replace(/[«"][^»"]+[»"]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const rest =
        stripped.length >= 8
          ? stripped
          : "contenu du sermon";
      return {
        semantic: baseDeterministicSemantic({
          search_mode: "sermon_title_then_topic_search",
          intent: `Recherche dans le sermon identifié par le titre cité`,
          topic: rest.slice(0, 200),
          sermon_hint: quoted.slice(0, 240),
          restrict_sermon_slug: resolved,
          passage_brief: "Périmètre strict : un seul sermon (titre résolu).",
          retrieval_phrases: [rest.slice(0, 200)],
          content_types: ["scoped_sermon"],
        }),
        preFetchedCandidates: null,
        skipRankingLlm: false,
      };
    }
  }

  return null;
}
