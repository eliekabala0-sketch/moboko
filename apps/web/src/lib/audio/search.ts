import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAudioAccess } from "@/lib/audio/access";

export type RequestedMedia = "text" | "audio";

export type AudioSearchResult = {
  audio_id: string;
  sermon_id: string | null;
  sermon_slug: string | null;
  sermon_title_fr: string;
  sermon_title_original: string | null;
  sermon_date: string | null;
  sermon_year: number | null;
  location: string | null;
  audio_duration_seconds: number | null;
  audio_available: true;
  audio_access_state: "allowed" | "free" | "subscription_required";
  audio_is_free: boolean;
  sermon_match_status: "matched" | "probable_match" | "manual_review" | "unmatched";
};

export function normalizeAudioSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function requestedMedia(value: string): RequestedMedia {
  const text = normalizeAudioSearch(value);
  const explicitText = /(texte|messages?|citations?)( uniquement| seulement)|sans audio/.test(text);
  if (explicitText) return "text";
  const explicitAudio = /(audio|audios|ecouter|ecoute|predications?)( uniquement| seulement)|seulement les sermons audio|je veux ecouter|trouve moi.*audio/.test(text);
  return explicitAudio ? "audio" : "text";
}

export function audioSearchTerms(value: string) {
  const stop = new Set(["audio", "audios", "sermon", "sermons", "predication", "predications", "uniquement", "seulement", "trouve", "trouver", "cherche", "chercher", "moi", "veux", "ecouter", "ecoute", "sur", "dans", "les", "des", "une", "pour"]);
  return normalizeAudioSearch(value).split(/\s+/).filter((term) => term.length >= 2 && !stop.has(term)).slice(0, 10);
}

function embeddedSermon(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as { id?: string; slug?: string; title?: string; preached_on?: string | null; year?: number | null; location?: string | null };
}

export async function searchActiveSermonAudio(
  admin: SupabaseClient,
  user: User | null,
  rawQuery: string,
  limit = 20,
): Promise<AudioSearchResult[]> {
  const { data, error } = await admin
    .from("audio_items")
    .select("id,title,title_original,original_filename,sermon_id,sermon_match_status,sermon_date,sermon_year,location,duration_seconds,access_policy,sermons(id,slug,title,preached_on,year,location)")
    .eq("category", "sermon")
    .eq("media_type", "audio")
    .eq("is_active", true)
    .eq("streaming_enabled", true)
    .limit(1000);
  if (error) throw error;

  const terms = audioSearchTerms(rawQuery);
  const baseAccess = await getAudioAccess(admin, user);
  return (data ?? [])
    .map((row) => {
      const sermon = embeddedSermon(row.sermons);
      const titleFr = sermon?.title?.trim() || row.title;
      const titleOriginal = (row.title_original || row.title || "").trim() || null;
      const haystack = normalizeAudioSearch([
        titleFr,
        titleOriginal,
        row.original_filename,
        row.sermon_date,
        row.sermon_year,
        sermon?.slug,
      ].filter(Boolean).join(" "));
      const matched = terms.length === 0 ? 1 : terms.filter((term) => haystack.includes(term)).length;
      const score = terms.length === 0 ? 1 : matched / terms.length;
      const policy = String(row.access_policy ?? "subscription");
      const audioIsFree = policy === "free" || policy === "excerpt";
      const accessState: AudioSearchResult["audio_access_state"] = baseAccess.audio_streaming
        ? "allowed"
        : audioIsFree
          ? "free"
          : "subscription_required";
      return {
        score,
        result: {
          audio_id: row.id,
          sermon_id: row.sermon_id,
          sermon_slug: sermon?.slug ?? null,
          sermon_title_fr: titleFr,
          sermon_title_original: titleOriginal && normalizeAudioSearch(titleOriginal) !== normalizeAudioSearch(titleFr) ? titleOriginal : null,
          sermon_date: sermon?.preached_on ?? row.sermon_date ?? null,
          sermon_year: sermon?.year ?? row.sermon_year ?? null,
          location: sermon?.location ?? row.location ?? null,
          audio_duration_seconds: row.duration_seconds ?? null,
          audio_available: true as const,
          audio_access_state: accessState,
          audio_is_free: audioIsFree,
          sermon_match_status:
            row.sermon_match_status === "matched" || row.sermon_match_status === "probable_match" || row.sermon_match_status === "manual_review"
              ? row.sermon_match_status
              : "unmatched",
        },
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.result.sermon_date ?? "9999").localeCompare(b.result.sermon_date ?? "9999"))
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((entry) => entry.result);
}
