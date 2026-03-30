import type { SupabaseClient } from "@supabase/supabase-js";

export type NeighborParagraphs = {
  prev_paragraph_number: number | null;
  prev_paragraph_text: string | null;
  next_paragraph_number: number | null;
  next_paragraph_text: string | null;
};

/**
 * Récupère les paragraphes §(n-1) et §(n+1) pour un sermon publié (texte exact base).
 */
export async function fetchNeighborParagraphs(
  admin: SupabaseClient,
  slug: string,
  paragraphNumber: number,
): Promise<NeighborParagraphs> {
  const { data: sermon } = await admin
    .from("sermons")
    .select("id")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (!sermon?.id) {
    return {
      prev_paragraph_number: null,
      prev_paragraph_text: null,
      next_paragraph_number: null,
      next_paragraph_text: null,
    };
  }

  const sid = sermon.id as string;
  const [prevRes, nextRes] = await Promise.all([
    admin
      .from("sermon_paragraphs")
      .select("paragraph_number, paragraph_text")
      .eq("sermon_id", sid)
      .eq("paragraph_number", paragraphNumber - 1)
      .maybeSingle(),
    admin
      .from("sermon_paragraphs")
      .select("paragraph_number, paragraph_text")
      .eq("sermon_id", sid)
      .eq("paragraph_number", paragraphNumber + 1)
      .maybeSingle(),
  ]);

  const prev = prevRes.data as { paragraph_number?: number; paragraph_text?: string } | null;
  const next = nextRes.data as { paragraph_number?: number; paragraph_text?: string } | null;

  return {
    prev_paragraph_number: typeof prev?.paragraph_number === "number" ? prev.paragraph_number : null,
    prev_paragraph_text: typeof prev?.paragraph_text === "string" ? prev.paragraph_text : null,
    next_paragraph_number: typeof next?.paragraph_number === "number" ? next.paragraph_number : null,
    next_paragraph_text: typeof next?.paragraph_text === "string" ? next.paragraph_text : null,
  };
}
