import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeLikePattern } from "@/lib/sermons/search";

export type SermonParagraphCandidate = {
  slug: string;
  title: string;
  year: number | null;
  preached_on: string | null;
  location: string | null;
  paragraph_number: number;
  paragraph_text: string;
};

const FR_STOP = new Set([
  "dans",
  "avec",
  "pour",
  "cette",
  "comme",
  "entre",
  "aussi",
  "tout",
  "tous",
  "toute",
  "toutes",
  "être",
  "était",
  "chez",
  "plus",
  "moins",
  "trouve",
  "trouver",
  "cherche",
  "chercher",
  "sermon",
  "passage",
  "paragraphe",
  "texte",
  "vers",
  "sont",
  "est",
  "aux",
  "des",
  "les",
  "une",
  "pas",
  "sur",
  "par",
  "que",
  "qui",
  "son",
  "ses",
  "leur",
  "leurs",
]);

function normalizeSermonEmbed(emb: unknown): {
  slug: string;
  title: string;
  year: number | null;
  preached_on: string | null;
  location: string | null;
  is_published: boolean;
} | null {
  const row = Array.isArray(emb) ? emb[0] : emb;
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  if (typeof o.slug !== "string" || typeof o.title !== "string") return null;
  if (o.is_published === false) return null;
  return {
    slug: o.slug,
    title: o.title,
    year: typeof o.year === "number" ? o.year : null,
    preached_on: typeof o.preached_on === "string" ? o.preached_on : null,
    location: typeof o.location === "string" ? o.location : null,
    is_published: o.is_published !== false,
  };
}

function rowToCandidate(row: {
  paragraph_number: unknown;
  paragraph_text: unknown;
  sermons: unknown;
}): SermonParagraphCandidate | null {
  const meta = normalizeSermonEmbed(row.sermons);
  if (!meta) return null;
  const n = row.paragraph_number;
  const t = row.paragraph_text;
  if (typeof n !== "number" || typeof t !== "string") return null;
  return {
    slug: meta.slug,
    title: meta.title,
    year: meta.year,
    preached_on: meta.preached_on,
    location: meta.location,
    paragraph_number: n,
    paragraph_text: t,
  };
}

export function extractTitleTokens(query: string): string[] {
  const raw = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  for (const w of raw) {
    if (w.length < 4) continue;
    if (FR_STOP.has(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}

function candidateKey(c: SermonParagraphCandidate) {
  return `${c.slug}:${c.paragraph_number}`;
}

function pushCandidates(
  seen: Set<string>,
  acc: SermonParagraphCandidate[],
  rows: unknown[] | null,
) {
  for (const row of rows ?? []) {
    const c = rowToCandidate(row as { paragraph_number: unknown; paragraph_text: unknown; sermons: unknown });
    if (!c) continue;
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    acc.push(c);
  }
}

/** Tronque pour le prompt LLM (le texte exact est réappliqué côté serveur après sélection). */
export function clipForPrompt(text: string, max = 520) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export async function fetchSermonSearchCandidates(
  admin: SupabaseClient,
  query: string,
): Promise<SermonParagraphCandidate[]> {
  const seen = new Set<string>();
  const acc: SermonParagraphCandidate[] = [];

  const runFts = async (q: string, limit: number) => {
    const { data } = await admin
      .from("sermon_paragraphs")
      .select(
        "paragraph_number, paragraph_text, sermons ( slug, title, year, preached_on, location, is_published )",
      )
      .textSearch("search_tsv", q, { type: "websearch", config: "french" })
      .limit(limit);
    pushCandidates(seen, acc, data as unknown[]);
  };

  await runFts(query, 50);

  if (acc.length === 0 && query.length > 100) {
    await runFts(query.slice(0, 200).trim(), 40);
  }

  const tokens = extractTitleTokens(query);
  if (tokens.length > 0) {
    const orClauses = tokens
      .map((t) => {
        const s = sanitizeLikePattern(t);
        if (!s) return null;
        return `title.ilike.%${s}%`;
      })
      .filter(Boolean) as string[];

    if (orClauses.length > 0) {
      const { data: sermons } = await admin
        .from("sermons")
        .select("id")
        .eq("is_published", true)
        .or(orClauses.join(","))
        .limit(14);

      const ids = (sermons ?? [])
        .map((x) => (x as { id?: string }).id)
        .filter((id): id is string => Boolean(id));

      if (ids.length > 0) {
        const countBeforeScoped = acc.length;
        const { data: scoped } = await admin
          .from("sermon_paragraphs")
          .select(
            "paragraph_number, paragraph_text, sermons ( slug, title, year, preached_on, location, is_published )",
          )
          .in("sermon_id", ids)
          .textSearch("search_tsv", query, { type: "websearch", config: "french" })
          .limit(36);
        pushCandidates(seen, acc, scoped as unknown[]);

        if (acc.length === countBeforeScoped) {
          const { data: fallback } = await admin
            .from("sermon_paragraphs")
            .select(
              "paragraph_number, paragraph_text, sermons ( slug, title, year, preached_on, location, is_published )",
            )
            .in("sermon_id", ids.slice(0, 4))
            .order("sermon_id", { ascending: true })
            .order("paragraph_number", { ascending: true })
            .limit(40);
          pushCandidates(seen, acc, fallback as unknown[]);
        }
      }
    }
  }

  return acc.slice(0, 56);
}
