import type { ConcordanceHit } from "@/lib/sermons/concordance-types";

export type RetrievalScope =
  | { kind: "library" }
  | { kind: "sermon"; sermon_slug: string };

export type RetrievalOrchestratorResult = {
  ok: true;
  results: ConcordanceHit[];
  total_count: number;
  scope: RetrievalScope;
  next_offset: number | null;
  offset: number;
  page_size: number;
  has_more: boolean;
};

export type LastRetrievalState = {
  query: string;
  scope: RetrievalScope;
  offset: number;
  page_size: number;
  total_count: number;
  next_offset: number | null;
  has_more: boolean;
};

