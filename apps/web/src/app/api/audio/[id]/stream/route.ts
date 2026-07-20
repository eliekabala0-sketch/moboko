import { canUseAudioRight, getAudioAccess } from "@/lib/audio/access";
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
  if (!canUseAudioRight(access, "audio_streaming")) {
    return NextResponse.json({ error: "abonnement_audio_requis", message: "Votre abonnement ne permet pas l'ecoute audio." }, { status: 402 });
  }
  const { id } = await params;
  const { data: audio } = await admin
    .from("audio_items")
    .select("id, title, storage_bucket, storage_path, is_active, streaming_enabled")
    .eq("id", id)
    .maybeSingle();
  if (!audio?.is_active || !audio.streaming_enabled) return NextResponse.json({ error: "audio_indisponible" }, { status: 404 });
  const { data, error } = await admin.storage.from(audio.storage_bucket).createSignedUrl(audio.storage_path, 900);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "url_audio_indisponible" }, { status: 500 });
  return NextResponse.json({ ok: true, url: data.signedUrl, expires_in: 900 });
}
