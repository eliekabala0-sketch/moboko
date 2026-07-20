import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  const { id } = await params;
  const { data } = await admin
    .from("audio_progress")
    .select("position_seconds, completed, updated_at")
    .eq("user_id", user.id)
    .eq("audio_id", id)
    .maybeSingle();
  return NextResponse.json({ ok: true, progress: data ?? { position_seconds: 0, completed: false } });
}

export async function POST(request: Request, { params }: Params) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { position_seconds?: unknown; completed?: unknown };
  const position = Math.max(0, Math.floor(Number(body.position_seconds ?? 0) || 0));
  const completed = body.completed === true;
  const { error } = await admin.from("audio_progress").upsert(
    {
      user_id: user.id,
      audio_id: id,
      position_seconds: position,
      completed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,audio_id" },
  );
  if (error) return NextResponse.json({ error: "progression_audio_indisponible" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
