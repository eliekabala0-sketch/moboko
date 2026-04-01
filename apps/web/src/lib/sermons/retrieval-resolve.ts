import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenAIClient } from "@/lib/ai/moboko-chat";
import {
  fetchConcordanceSemanticCandidates,
  type ConcordanceFetchProfile,
} from "@/lib/sermons/concordance-fetch-candidates";
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
  },
): Promise<HybridRetrievalResult> {
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
    };
  }

  let semantic: SemanticIntent | null = null;
  try {
    semantic = await runRetrievalAgent(openai, query, opts.turnContextBlock);
  } catch {
    semantic = null;
  }
  if (semantic) semantic = applyFollowUpSlug(semantic, opts.primarySlug);

  const candidates = await fetchConcordanceSemanticCandidates(admin, query, semantic, opts.profile);
  const skipRankingLlm = candidates.length <= 3;
  return {
    semantic,
    candidates,
    skipRankingLlm,
    usedRetrievalAgent: true,
  };
}
