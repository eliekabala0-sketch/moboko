import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const FIELDS = [
  "all_notifications",
  "important_announcements",
  "publications",
  "prayer_requests",
  "testimonies",
  "prayer_replies",
  "testimony_replies",
] as const;

export async function GET(request: Request) {
  const { user, error } = await getUserFromApiRequest(request);
  if (error || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  await admin.from("notification_preferences").upsert({ user_id: user.id }, { onConflict: "user_id" });
  const { data } = await admin.from("notification_preferences").select(FIELDS.join(", ")).eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ ok: true, preferences: data });
}

export async function POST(request: Request) {
  const { user, error } = await getUserFromApiRequest(request);
  if (error || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const payload: Record<string, boolean | string> = { user_id: user.id };
  for (const field of FIELDS) {
    if (typeof body[field] === "boolean") payload[field] = body[field];
  }
  const { error: saveError } = await admin.from("notification_preferences").upsert(payload, { onConflict: "user_id" });
  if (saveError) return NextResponse.json({ error: "preferences_notifications_refusees" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
