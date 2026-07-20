import { audioPublicSelect, getAudioAccess } from "@/lib/audio/access";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const { id } = await params;
  const { user } = await getUserFromApiRequest(request);
  const access = await getAudioAccess(admin, user ?? null);
  const { data, error } = await admin
    .from("audio_items")
    .select(audioPublicSelect())
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "audio_indisponible" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "audio_introuvable" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    audio: data,
    access: {
      audio_streaming: access.audio_streaming,
      audio_offline_in_app: access.audio_offline_in_app,
      audio_full_download: access.audio_full_download,
      audio_search: access.audio_search,
      plan_key: access.planKey,
      override_applied: access.overrideApplied,
    },
  });
}
