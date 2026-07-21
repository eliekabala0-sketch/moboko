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
  const extendedPayload = {
    ...payload,
    access_policy: text(formData, "access_policy") || "subscription",
    free_excerpt_seconds: Math.max(0, Math.floor(numberOrNull(formData, "free_excerpt_seconds") ?? 0)),
    free_monthly_play_limit: numberOrNull(formData, "free_monthly_play_limit"),
  };
  let { error } = await supabase.from("audio_items").update(extendedPayload).eq("id", id);
  if (error?.code === "42703" || error?.code === "PGRST204") {
    const fallback = await supabase.from("audio_items").update(payload).eq("id", id);
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
  revalidatePath("/admin/audio");
  revalidatePath("/audio");
}

export async function saveAudioAccessSettingsAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const payload = {
    id: true,
    free_streaming_enabled: boolValue(formData, "free_streaming_enabled"),
    free_streaming_monthly_limit: numberOrNull(formData, "free_streaming_monthly_limit"),
    free_offline_in_app: boolValue(formData, "free_offline_in_app"),
    free_full_download: boolValue(formData, "free_full_download"),
    free_audio_search: boolValue(formData, "free_audio_search"),
    free_excerpt_seconds: Math.max(0, Math.floor(numberOrNull(formData, "free_excerpt_seconds") ?? 0)),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("audio_access_settings").upsert(payload, { onConflict: "id" });
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
