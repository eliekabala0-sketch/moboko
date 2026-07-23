import type { SupabaseClient } from "@supabase/supabase-js";

type ResultLike = {
  slug?: unknown;
  paragraph_number?: unknown;
  [key: string]: unknown;
};

export async function attachLinkedSermonAudio<T extends ResultLike>(
  admin: SupabaseClient,
  results: T[],
  audioStreamingAllowed = false,
): Promise<T[]> {
  const slugs = [...new Set(results.map((item) => (typeof item.slug === "string" ? item.slug : "")).filter(Boolean))];
  if (slugs.length === 0) return results;

  const { data: sermons, error: sermonError } = await admin
    .from("sermons")
    .select("id,slug,title,preached_on,year,location")
    .in("slug", slugs)
    .limit(1000);
  if (sermonError) return results;
  const sermonBySlug = new Map((sermons ?? []).map((sermon) => [sermon.slug, sermon]));
  const sermonIds = (sermons ?? []).map((sermon) => sermon.id);

  const { data: audioRows } = sermonIds.length > 0
    ? await admin
        .from("audio_items")
        .select("id,sermon_id,duration_seconds,access_policy,title,title_original")
        .eq("category", "sermon")
        .eq("is_active", true)
        .eq("streaming_enabled", true)
        .in("sermon_id", sermonIds)
        .order("sermon_match_score", { ascending: false, nullsFirst: false })
        .limit(1000)
    : { data: [] };
  const audioBySermon = new Map<string, Record<string, unknown>>();
  for (const row of audioRows ?? []) {
    if (row.sermon_id && !audioBySermon.has(row.sermon_id)) audioBySermon.set(row.sermon_id, row);
  }

  const paragraphNumbers = [...new Set(results.map((item) => Number(item.paragraph_number)).filter((number) => Number.isFinite(number) && number > 0))];
  const paragraphIds = new Map<string, string>();
  if (sermonIds.length > 0 && paragraphNumbers.length > 0) {
    const { data: paragraphs } = await admin
      .from("sermon_paragraphs")
      .select("id,sermon_id,paragraph_number")
      .in("sermon_id", sermonIds)
      .in("paragraph_number", paragraphNumbers)
      .limit(5000);
    for (const paragraph of paragraphs ?? []) paragraphIds.set(`${paragraph.sermon_id}:${paragraph.paragraph_number}`, paragraph.id);
  }

  return results.map((item) => {
    const slug = typeof item.slug === "string" ? item.slug : "";
    const sermon = sermonBySlug.get(slug);
    if (!sermon) return item;
    const audio = audioBySermon.get(sermon.id);
    const paragraphId = paragraphIds.get(`${sermon.id}:${Number(item.paragraph_number)}`) ?? null;
    if (!audio) {
      return {
        ...item,
        sermon_id: sermon.id,
        paragraph_id: paragraphId,
        sermon_title_fr: sermon.title,
        sermon_date: sermon.preached_on ?? null,
        audio_available: false,
        audio_id: null,
        linked_audio_id: null,
        audio_access_state: null,
        audio_is_free: false,
        audio_duration_seconds: null,
      } as T;
    }
    const isFree = audio.access_policy === "free" || audio.access_policy === "excerpt";
    return {
      ...item,
      sermon_id: sermon.id,
      paragraph_id: paragraphId,
      sermon_title_fr: sermon.title,
      sermon_title_original: audio.title_original ?? audio.title ?? null,
      sermon_date: sermon.preached_on ?? null,
      audio_available: true,
      audio_id: audio.id,
      linked_audio_id: audio.id,
      audio_access_state: audioStreamingAllowed ? "allowed" : isFree ? "free" : "subscription_required",
      audio_is_free: isFree,
      audio_duration_seconds: audio.duration_seconds ?? null,
    } as T;
  });
}
