import { canUseAudioRight, getAudioAccess } from "@/lib/audio/access";
import { isManifestPath, loadAudioManifest, streamManifestRange } from "@/lib/audio/chunked-stream";
import { createAudioToken, verifyAudioToken } from "@/lib/audio/stream-token";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const { id } = await params;
  let audioResult = await admin
    .from("audio_items")
    .select("id, title, storage_bucket, storage_path, is_active, streaming_enabled, access_policy, free_excerpt_seconds, free_monthly_play_limit")
    .eq("id", id)
    .maybeSingle();
  if (audioResult.error) {
    audioResult = await admin
      .from("audio_items")
      .select("id, title, storage_bucket, storage_path, is_active, streaming_enabled")
      .eq("id", id)
      .maybeSingle();
  }
  const audio = audioResult.data;
  if (!audio?.is_active || !audio.streaming_enabled || audio.access_policy === "unavailable") {
    return NextResponse.json({ error: "audio_indisponible" }, { status: 404 });
  }
  const { user } = await getUserFromApiRequest(request);
  const access = await getAudioAccess(admin, user ?? null, audio);
  if (!canUseAudioRight(access, "audio_streaming")) {
    return NextResponse.json({ error: "abonnement_audio_requis", message: "Votre abonnement ne permet pas l'ecoute audio." }, { status: 402 });
  }
  await admin.from("audio_play_events").insert({
    user_id: user?.id ?? null,
    audio_id: audio.id,
    event_type: "stream",
    access_source: access.accessSource === "none" ? "subscription" : access.accessSource,
  });
  if (isManifestPath(audio.storage_path)) {
    const token = createAudioToken({ audioId: audio.id, action: "stream", exp: Math.floor(Date.now() / 1000) + 900 });
    return NextResponse.json({ ok: true, url: `/api/audio/${audio.id}/stream?token=${encodeURIComponent(token)}`, expires_in: 900 });
  }
  const { data, error } = await admin.storage.from(audio.storage_bucket).createSignedUrl(audio.storage_path, 900);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "url_audio_indisponible" }, { status: 500 });
  return NextResponse.json({ ok: true, url: data.signedUrl, expires_in: 900 });
}

export async function GET(request: Request, { params }: Params) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!verifyAudioToken(token, id, "stream")) return NextResponse.json({ error: "lien_audio_expire" }, { status: 401 });
  const { data: audio } = await admin
    .from("audio_items")
    .select("id, storage_bucket, storage_path, is_active, streaming_enabled")
    .eq("id", id)
    .maybeSingle();
  if (!audio?.is_active || !audio.streaming_enabled || !isManifestPath(audio.storage_path)) {
    return NextResponse.json({ error: "audio_indisponible" }, { status: 404 });
  }
  const manifest = await loadAudioManifest(admin, audio.storage_bucket, audio.storage_path);
  return streamManifestRange(admin, manifest, request.headers.get("range"));
}
