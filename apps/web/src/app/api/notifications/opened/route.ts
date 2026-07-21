import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { eventId?: unknown };
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId) return NextResponse.json({ error: "notification_introuvable" }, { status: 400 });
  await admin
    .from("notification_deliveries")
    .update({ status: "opened", opened_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .in("status", ["sent", "opened"]);
  return NextResponse.json({ ok: true });
}
