/**
 * Recherche bibliothèque sermons (filtres métadonnées + extraits paragraphes).
 * Full-text paragraphes : colonne search_tsv (GIN, config french) via Supabase .textSearch.
 */

/** Retire les caractères jokers ILIKE pour éviter injection de pattern. */
export function sanitizeLikePattern(raw: string): string {
  return raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Extrait un passage autour de la première occurrence d’un token de la requête.
 */
export function buildParagraphExcerpt(
  paragraphText: string,
  searchQuery: string,
  maxLen = 260,
): string {
  const cleaned = paragraphText.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const q = searchQuery.trim();
  if (!q) {
    return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
  }
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^["']|["']$/g, ""))
    .filter((t) => t.length > 1);
  const lower = cleaned.toLowerCase();
  let idx = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
  }
  const pad = Math.floor(maxLen / 2);
  const start = Math.max(0, idx - pad);
  const end = Math.min(cleaned.length, start + maxLen);
  const slice = cleaned.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < cleaned.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}

export function extractSearchTerms(searchQuery: string): string[] {
  const q = searchQuery.trim();
  if (!q) return [];
  const stop = new Set([
    "a",
    "au",
    "aux",
    "ce",
    "ces",
    "de",
    "des",
    "du",
    "en",
    "et",
    "la",
    "le",
    "les",
    "nous",
    "ou",
    "où",
    "par",
    "pour",
    "que",
    "qui",
    "sur",
    "un",
    "une",
    "vous",
  ]);
  const normalized = q
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const conceptTerms =
    /\b(seule chair|devien|deux|epoux|mariage|mari|femme)\b/.test(normalized)
      ? ["une seule chair", "deviennent un", "mari et femme", "homme et femme", "ne sont plus deux"]
      : [];
  const quoted = Array.from(q.matchAll(/"([^"]{2,})"/g))
    .map((m) => m[1]?.trim())
    .filter((t): t is string => Boolean(t));
  const words = q
    .replace(/"([^"]*)"/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^["']|["']$/g, "").trim())
    .filter((t) => t.length > 2)
    .filter((t) => !stop.has(t.toLowerCase()));
  return Array.from(new Set([...conceptTerms, ...quoted, ...words])).sort((a, b) => b.length - a.length);
}

export function paragraphMatchesQuery(paragraphText: string, searchQuery: string): boolean {
  const terms = extractSearchTerms(searchQuery);
  if (terms.length === 0) return true;
  const lower = paragraphText.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

export type SermonListRow = {
  id: string;
  slug: string;
  title: string;
  preached_on: string | null;
  year: number | null;
  location: string | null;
  paragraph_count: number;
};

export type ParagraphHitRow = {
  paragraph_number: number;
  paragraph_text: string;
  sermons: {
    slug: string;
    title: string;
    year: number | null;
    preached_on?: string | null;
    location?: string | null;
  } | null;
};
