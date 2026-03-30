/**
 * Données affichées côté client pour la concordance (chat + recherche IA sermons).
 * Texte des paragraphes : copie exacte base.
 */
export type ConcordanceHit = {
  slug: string;
  title: string;
  location: string | null;
  date: string | null;
  paragraph_number: number;
  paragraph_text: string;
  prev_paragraph_number: number | null;
  prev_paragraph_text: string | null;
  next_paragraph_number: number | null;
  next_paragraph_text: string | null;
};

export function hitKey(h: Pick<ConcordanceHit, "slug" | "paragraph_number">): string {
  return `${h.slug}:${h.paragraph_number}`;
}

/** Interprète le JSON `metadata.results` renvoyé par l’API (tolérant). */
export function coerceConcordanceHits(raw: unknown): ConcordanceHit[] {
  if (!Array.isArray(raw)) return [];
  const out: ConcordanceHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const slug = typeof o.slug === "string" ? o.slug.trim() : "";
    const title = typeof o.title === "string" ? o.title : "";
    const paragraph_number = typeof o.paragraph_number === "number" ? o.paragraph_number : 0;
    const paragraph_text = typeof o.paragraph_text === "string" ? o.paragraph_text : "";
    if (!slug || !title || paragraph_number < 1 || !paragraph_text) continue;
    const loc = o.location;
    const po = o.preached_on;
    const yr = o.year;
    const dt = o.date;
    let date: string | null = null;
    if (typeof dt === "string" && dt.trim()) date = dt.trim();
    else if (typeof po === "string" && po.trim()) date = po.trim();
    else if (typeof yr === "number" && Number.isFinite(yr)) date = String(yr);
    out.push({
      slug,
      title,
      location: typeof loc === "string" ? loc.trim() || null : null,
      date,
      paragraph_number,
      paragraph_text,
      prev_paragraph_number:
        typeof o.prev_paragraph_number === "number" ? o.prev_paragraph_number : null,
      prev_paragraph_text:
        typeof o.prev_paragraph_text === "string" ? o.prev_paragraph_text : null,
      next_paragraph_number:
        typeof o.next_paragraph_number === "number" ? o.next_paragraph_number : null,
      next_paragraph_text:
        typeof o.next_paragraph_text === "string" ? o.next_paragraph_text : null,
    });
  }
  return out;
}
