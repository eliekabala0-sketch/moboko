import { audioPublicSelect, getAudioAccess } from "@/lib/audio/access";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sanitizeLike } from "@/lib/library/format";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const sort = url.searchParams.get("sort") ?? "recent";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 20) || 20));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { user } = await getUserFromApiRequest(request);
  const access = await getAudioAccess(admin, user ?? null);

  let query = admin
    .from("audio_items")
    .select(audioPublicSelect(), { count: "exact" })
    .eq("media_type", "audio")
    .eq("is_active", true);
  if (category === "sermon" || category === "prayer_line") query = query.eq("category", category);
  if (q.length >= 2) {
    const safe = sanitizeLike(normalize(q));
    query = query.or(`normalized_title.ilike.%${safe}%,original_filename.ilike.%${sanitizeLike(q)}%`);
  }

  if (sort === "oldest") query = query.order("sermon_date", { ascending: true, nullsFirst: false }).order("title", { ascending: true });
  else if (sort === "az") query = query.order("title", { ascending: true });
  else if (sort === "za") query = query.order("title", { ascending: false });
  else query = query.order("sermon_date", { ascending: false, nullsFirst: false }).order("title", { ascending: true });

  const { data, count, error } = await query.range(from, to);
  if (error) return NextResponse.json({ error: "audio_indisponible" }, { status: 500 });

  return NextResponse.json({
    ok: true,
    results: data ?? [],
    count: count ?? 0,
    page,
    limit,
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
