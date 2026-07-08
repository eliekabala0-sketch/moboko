import type { SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";

function dateKey(c: Pick<SermonParagraphCandidate, "preached_on" | "year">): string {
  if (c.preached_on?.trim()) return c.preached_on.trim();
  if (typeof c.year === "number" && Number.isFinite(c.year)) {
    return `${String(c.year).padStart(4, "0")}-01-01`;
  }
  return "9999-12-31";
}

/**
 * Default Moboko evidence order: oldest sermon occurrence first.
 * Each distinct sermon/paragraph occurrence is kept.
 */
export function sortSermonOccurrencesOldestFirst<T extends SermonParagraphCandidate>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const d = dateKey(a).localeCompare(dateKey(b));
    if (d !== 0) return d;
    const title = a.title.localeCompare(b.title, "fr");
    if (title !== 0) return title;
    return a.paragraph_number - b.paragraph_number;
  });
}
