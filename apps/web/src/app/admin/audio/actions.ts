"use server";

import { requireAdmin } from "@/lib/admin/require-admin";
import { revalidatePath } from "next/cache";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function boolValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function numberOrNull(formData: FormData, key: string) {
  const raw = text(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function saveAudioItemAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const id = text(formData, "id");
  if (!id) throw new Error("Audio requis");
  const title = text(formData, "title");
  if (!title) throw new Error("Titre requis");
  const sermonId = text(formData, "sermon_id");
  const payload = {
    title,
    normalized_title: title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
    sermon_year: numberOrNull(formData, "sermon_year"),
    location: text(formData, "location") || null,
    sermon_id: sermonId || null,
    sermon_match_status: text(formData, "sermon_match_status") || "manual_review",
    is_active: boolValue(formData, "is_active"),
    streaming_enabled: boolValue(formData, "streaming_enabled"),
    offline_enabled: boolValue(formData, "offline_enabled"),
    full_download_enabled: boolValue(formData, "full_download_enabled"),
    updated_by: user.id,
  };
  const { error } = await supabase.from("audio_items").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/audio");
  revalidatePath("/audio");
}

export async function saveAudioOverrideAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const userId = text(formData, "user_id");
  if (!userId) throw new Error("Utilisateur requis");
  const payload = {
    user_id: userId,
    audio_streaming: formData.has("audio_streaming") ? boolValue(formData, "audio_streaming") : null,
    audio_offline_in_app: formData.has("audio_offline_in_app") ? boolValue(formData, "audio_offline_in_app") : null,
    audio_full_download: formData.has("audio_full_download") ? boolValue(formData, "audio_full_download") : null,
    audio_search: formData.has("audio_search") ? boolValue(formData, "audio_search") : null,
    expires_at: text(formData, "expires_at") || null,
    notes: text(formData, "notes") || null,
    created_by: user.id,
  };
  const { error } = await supabase.from("user_audio_access_overrides").upsert(payload, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/audio");
}
