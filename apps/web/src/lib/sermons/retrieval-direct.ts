import type { SupabaseClient } from "@supabase/supabase-js";
import type { SermonParagraphCandidate } from "@/lib/sermons/ai-sermon-search-server";
import { sanitizeLikePattern } from "@/lib/sermons/search";

function rowToCandidate(row: {
  paragraph_number: unknown;
  paragraph_text: unknown;
  sermons: unknown;
}): SermonParagraphCandidate | null {
  const emb = row.sermons;
  const rowS = Array.isArray(emb) ? emb[0] : emb;
  if (!rowS || typeof rowS !== "object") return null;
  const m = rowS as Record<string, unknown>;
  if (typeof m.slug !== "string" || typeof m.title !== "string") return null;
  if (m.is_published === false) return null;
  const n = row.paragraph_number;
  const t = row.paragraph_text;
  if (typeof n !== "number" || typeof t !== "string") return null;
  return {
    slug: m.slug,
    title: m.title,
    year: typeof m.year === "number" ? m.year : null,
    preached_on: typeof m.preached_on === "string" ? m.preached_on : null,
    location: typeof m.location === "string" ? m.location : null,
    paragraph_number: n,
    paragraph_text: t,
  };
}

/** Un paragraphe précis (slug + numéro), sermon publié uniquement. */
export async function fetchSingleParagraphCandidate(
  admin: SupabaseClient,
  slug: string,
  paragraphNumber: number,
): Promise<SermonParagraphCandidate | null> {
  const { data: sermon } = await admin
    .from("sermons")
    .select("id")
    .eq("slug", slug.trim())
    .eq("is_published", true)
    .maybeSingle();
  if (!sermon || typeof (sermon as { id?: string }).id !== "string") return null;
  const sid = (sermon as { id: string }).id;
  const { data: row } = await admin
    .from("sermon_paragraphs")
    .select(
      "paragraph_number, paragraph_text, sermons ( slug, title, year, preached_on, location, is_published )",
    )
    .eq("sermon_id", sid)
    .eq("paragraph_number", paragraphNumber)
    .maybeSingle();
  if (!row) return null;
  return rowToCandidate(row as { paragraph_number: unknown; paragraph_text: unknown; sermons: unknown });
}

/** Résout un slug si un seul sermon publié matche le titre (fragment). */
export async function resolveUniqueSermonSlugByTitle(
  admin: SupabaseClient,
  titleFragment: string,
): Promise<string | null> {
  const t = sanitizeLikePattern(titleFragment);
  if (t.length < 4 || t.length > 200) return null;
  const { data: rows } = await admin
    .from("sermons")
    .select("slug")
    .eq("is_published", true)
    .ilike("title", `%${t}%`)
    .limit(5);
  const slugs = (rows ?? [])
    .map((r) => (r as { slug?: string }).slug)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  if (slugs.length !== 1) return null;
  return slugs[0];
}
