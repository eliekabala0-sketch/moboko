import { canUseAudioRight, getAudioAccess, safeAudioFilename } from "@/lib/audio/access";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  const access = await getAudioAccess(admin, user);
  if (!canUseAudioRight(access, "audio_full_download")) {
    return NextResponse.json({ error: "abonnement_audio_requis", message: "Votre abonnement ne permet pas le telechargement complet." }, { status: 402 });
  }
  const { id } = await params;
  const { data: audio } = await admin
    .from("audio_items")
    .select("id, title, original_filename, storage_bucket, storage_path, is_active, full_download_enabled, file_size")
    .eq("id", id)
    .maybeSingle();
  if (!audio?.is_active || !audio.full_download_enabled) return NextResponse.json({ error: "audio_indisponible" }, { status: 404 });
  const filename = safeAudioFilename(audio.original_filename || `${audio.title}.mp3`);
  const { data, error } = await admin.storage.from(audio.storage_bucket).createSignedUrl(audio.storage_path, 900, { download: filename });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "url_audio_indisponible" }, { status: 500 });
  await admin.from("audio_offline_records").insert({
    user_id: user.id,
    audio_id: audio.id,
    download_type: "full_download",
    device_id: "browser",
    file_size: audio.file_size,
    last_verified_at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, url: data.signedUrl, expires_in: 900, filename });
}
