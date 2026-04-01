/**
 * Intention / plan de retrieval partagé (chat + recherche IA sermons).
 * Aucun texte utilisateur : JSON interne uniquement.
 */

export type SemanticIntent = {
  search_mode:
    | "exact_quote_search"
    | "exact_paragraph_lookup"
    | "theme_search"
    | "situation_search"
    | "story_search"
    | "prayer_search"
    | "doctrinal_search"
    | "time_bounded_search"
    | "preaching_prep_search"
    | "comfort_or_exhortation_search"
    | "sermon_title_then_topic_search";
  user_need:
    | "simple_answer"
    | "orientation"
    | "exhortation"
    | "comfort"
    | "preaching_prep"
    | "citation_list"
    | "prayer_list"
    | "story_list";
  intent: string;
  topic: string;
  concepts: string[];
  expansions: string[];
  content_types: string[];
  quoted_phrase: string | null;
  sermon_hint: string | null;
  year_from: number | null;
  year_to: number | null;
  maybe_meant: string | null;
  retrieval_phrases: string[];
  avoid_lexical_bait: string[];
  passage_brief: string;
  restrict_sermon_slug: string | null;
  follow_up_continuity: boolean;
  /** § explicite : lookup direct quand combiné à restrict_sermon_slug. */
  paragraph_exact: number | null;
  /** 0–1 : confiance du plan (1 = déterministe). */
  confidence: number;
  routing_source: "deterministic" | "agent";
};

export function parseSemanticIntentFromModelJson(raw: string): SemanticIntent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const modeRaw =
    typeof o.search_mode === "string" ? o.search_mode.trim() : "theme_search";
  const search_mode: SemanticIntent["search_mode"] = (
    [
      "exact_quote_search",
      "exact_paragraph_lookup",
      "theme_search",
      "situation_search",
      "story_search",
      "prayer_search",
      "doctrinal_search",
      "time_bounded_search",
      "preaching_prep_search",
      "comfort_or_exhortation_search",
      "sermon_title_then_topic_search",
    ] as const
  ).includes(modeRaw as SemanticIntent["search_mode"])
    ? (modeRaw as SemanticIntent["search_mode"])
    : "theme_search";
  const needRaw =
    typeof o.user_need === "string" ? o.user_need.trim() : "orientation";
  const user_need: SemanticIntent["user_need"] = (
    [
      "simple_answer",
      "orientation",
      "exhortation",
      "comfort",
      "preaching_prep",
      "citation_list",
      "prayer_list",
      "story_list",
    ] as const
  ).includes(needRaw as SemanticIntent["user_need"])
    ? (needRaw as SemanticIntent["user_need"])
    : "orientation";
  const intent = typeof o.intent === "string" ? o.intent.trim().slice(0, 240) : "";
  const topic = typeof o.topic === "string" ? o.topic.trim().slice(0, 200) : "";
  const maybe_meant = typeof o.maybe_meant === "string" ? o.maybe_meant.trim().slice(0, 240) : null;
  const quoted_phrase =
    typeof o.quoted_phrase === "string" ? o.quoted_phrase.trim().slice(0, 240) : null;
  const sermon_hint =
    typeof o.sermon_hint === "string" ? o.sermon_hint.trim().slice(0, 240) : null;
  const year_from =
    typeof o.year_from === "number" && Number.isFinite(o.year_from)
      ? Math.max(1900, Math.min(2100, Math.floor(o.year_from)))
      : null;
  const year_to =
    typeof o.year_to === "number" && Number.isFinite(o.year_to)
      ? Math.max(1900, Math.min(2100, Math.floor(o.year_to)))
      : null;
  const concepts = Array.isArray(o.concepts)
    ? o.concepts
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const expansions = Array.isArray(o.expansions)
    ? o.expansions
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const content_types = Array.isArray(o.content_types)
    ? o.content_types
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const retrieval_phrases = Array.isArray(o.retrieval_phrases)
    ? o.retrieval_phrases
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const avoid_lexical_bait = Array.isArray(o.avoid_lexical_bait)
    ? o.avoid_lexical_bait
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const passage_brief =
    typeof o.passage_brief === "string" ? o.passage_brief.trim().slice(0, 420) : "";
  const restrict_sermon_slug =
    typeof o.restrict_sermon_slug === "string" && o.restrict_sermon_slug.trim()
      ? o.restrict_sermon_slug.trim().slice(0, 220)
      : null;
  const follow_up_continuity = o.follow_up_continuity === true;
  let paragraph_exact: number | null = null;
  if (typeof o.paragraph_exact === "number" && Number.isInteger(o.paragraph_exact)) {
    const pe = o.paragraph_exact;
    if (pe >= 1 && pe <= 50_000) paragraph_exact = pe;
  }
  let confidence = 0.72;
  if (typeof o.confidence === "number" && Number.isFinite(o.confidence)) {
    confidence = Math.max(0, Math.min(1, o.confidence));
  }
  return {
    search_mode,
    user_need,
    intent,
    topic,
    concepts,
    expansions,
    content_types,
    quoted_phrase,
    sermon_hint,
    year_from,
    year_to,
    maybe_meant,
    retrieval_phrases,
    avoid_lexical_bait,
    passage_brief,
    restrict_sermon_slug,
    follow_up_continuity,
    paragraph_exact,
    confidence,
    routing_source: "agent",
  };
}
