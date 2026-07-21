import type { SupabaseClient } from "@supabase/supabase-js";

type ResultLike = {
  slug?: unknown;
  [key: string]: unknown;
};

export async function attachLinkedSermonAudio<T extends ResultLike>(admin: SupabaseClient, results: T[]): Promise<T[]> {
  const slugs = [...new Set(results.map((item) => (typeof item.slug === "string" ? item.slug : "")).filter(Boolean))];
  if (slugs.length === 0) return results;

  const { data, error } = await admin
    .from("audio_items")
    .select("id, sermon_id, sermons!inner(slug)")
    .eq("category", "sermon")
    .eq("is_active", true)
    .eq("streaming_enabled", true)
    .in("sermons.slug", slugs)
    .limit(1000);

  if (error) return results;
  const bySlug = new Map<string, string>();
  for (const row of data ?? []) {
    const embedded = row.sermons;
    const sermon = Array.isArray(embedded) ? embedded[0] : embedded;
    const slug = typeof sermon?.slug === "string" ? sermon.slug : "";
    if (slug && typeof row.id === "string" && !bySlug.has(slug)) bySlug.set(slug, row.id);
  }

  return results.map((item) => {
    const slug = typeof item.slug === "string" ? item.slug : "";
    const audioId = bySlug.get(slug);
    return audioId ? ({ ...item, linked_audio_id: audioId } as T) : item;
  });
}
