import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenAIClient } from "@/lib/ai/moboko-chat";
import {
  fetchConcordanceSemanticCandidates,
  type ConcordanceFetchProfile,
} from "@/lib/sermons/concordance-fetch-candidates";
import { resolveBestSermonSlugByTitle } from "@/lib/sermons/retrieval-direct";
import { runRetrievalAgent } from "@/lib/sermons/retrieval-agent";
import { tryDeterministicRetrieval } from "@/lib/sermons/retrieval-deterministic";
import type { SemanticIntent } from "@/lib/sermons/semantic-intent";
import type { SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";

type OpenAIClient = NonNullable<ReturnType<typeof getOpenAIClient>>;

export function applyFollowUpSlug(semantic: SemanticIntent, primarySlug: string | null): SemanticIntent {
  if (semantic.restrict_sermon_slug) return semantic;
  if (!semantic.follow_up_continuity || !primarySlug) return semantic;
  return { ...semantic, restrict_sermon_slug: primarySlug };
}

export type HybridRetrievalResult = {
  semantic: SemanticIntent | null;
  candidates: SermonParagraphCandidate[];
  skipRankingLlm: boolean;
  usedRetrievalAgent: boolean;
  fallbackReason: string | null;
};

/**
 * Routeur hybride : déterministe d’abord (sans IA), puis retrieval agent si besoin.
 */
export async function resolveHybridRetrieval(
  admin: SupabaseClient,
  openai: OpenAIClient,
  query: string,
  opts: {
    primarySlug: string | null;
    turnContextBlock: string | null;
    profile: ConcordanceFetchProfile;
    agentFirst?: boolean;
  },
): Promise<HybridRetrievalResult> {
  if (!opts.agentFirst) {
    const det = await tryDeterministicRetrieval(admin, query, { primarySlug: opts.primarySlug });
    if (det) {
      const candidates =
        det.preFetchedCandidates != null
          ? det.preFetchedCandidates
          : await fetchConcordanceSemanticCandidates(admin, query, det.semantic, opts.profile);
      const skipRankingLlm = det.skipRankingLlm || candidates.length <= 3;
      return {
        semantic: det.semantic,
        candidates,
        skipRankingLlm,
        usedRetrievalAgent: false,
        fallbackReason: null,
      };
    }
  }

  let semantic: SemanticIntent | null = null;
  semantic = await runRetrievalAgent(openai, query, opts.turnContextBlock);
  if (semantic) semantic = applyFollowUpSlug(semantic, opts.primarySlug);
  if (semantic) semantic = await resolveSermonScope(admin, semantic);

  if (!semantic && opts.agentFirst) {
    const det = await tryDeterministicRetrieval(admin, query, { primarySlug: opts.primarySlug });
    if (det) {
      const candidates =
        det.preFetchedCandidates != null
          ? det.preFetchedCandidates
          : await fetchConcordanceSemanticCandidates(admin, query, det.semantic, opts.profile);
      return {
        semantic: det.semantic,
        candidates,
        skipRankingLlm: det.skipRankingLlm || candidates.length <= 3,
        usedRetrievalAgent: false,
        fallbackReason: "agent_empty_plan",
      };
    }
  }

  let candidates = await fetchConcordanceSemanticCandidates(admin, query, semantic, opts.profile);
  let fallbackReason: string | null = null;
  if (opts.agentFirst && semantic && candidates.length === 0) {
    const relaxed: SemanticIntent = {
      ...semantic,
      restrict_sermon_slug: null,
      search_mode: semantic.search_mode === "exact_quote_search" ? "theme_search" : semantic.search_mode,
      retrieval_phrases: [
        ...semantic.retrieval_phrases,
        semantic.intent,
        semantic.topic,
        ...semantic.concepts,
        query,
      ].filter(Boolean),
    };
    candidates = await fetchConcordanceSemanticCandidates(admin, query, relaxed, opts.profile);
    fallbackReason = "agent_plan_zero_candidates_relaxed";
  }
  const skipRankingLlm = candidates.length <= 3;
  return {
    semantic,
    candidates,
    skipRankingLlm,
    usedRetrievalAgent: true,
    fallbackReason,
  };
}

async function slugExists(admin: SupabaseClient, slug: string) {
  const { data } = await admin
    .from("sermons")
    .select("slug")
    .eq("is_published", true)
    .eq("slug", slug)
    .maybeSingle();
  return Boolean(data);
}

async function resolveSermonScope(
  admin: SupabaseClient,
  semantic: SemanticIntent,
): Promise<SemanticIntent> {
  const current = semantic.restrict_sermon_slug?.trim() || null;
  if (current && (await slugExists(admin, current))) return semantic;

  const hints = [semantic.sermon_hint, semantic.maybe_meant, semantic.topic]
    .filter((x): x is string => Boolean(x && x.trim().length >= 4));
  for (const hint of hints) {
    const slug = await resolveBestSermonSlugByTitle(admin, hint);
    if (slug) return { ...semantic, restrict_sermon_slug: slug, sermon_hint: semantic.sermon_hint ?? hint };
  }

  return current ? { ...semantic, restrict_sermon_slug: null } : semantic;
}
