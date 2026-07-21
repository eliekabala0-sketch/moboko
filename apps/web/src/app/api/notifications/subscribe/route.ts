import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SubscriptionBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

export async function POST(request: Request) {
  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as SubscriptionBody;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth.trim() : "";
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: "abonnement_push_invalide" }, { status: 400 });
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      is_active: true,
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: "abonnement_push_refuse" }, { status: 500 });
  await admin.from("notification_preferences").upsert({ user_id: user.id }, { onConflict: "user_id" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) return NextResponse.json({ error: "endpoint_manquant" }, { status: 400 });
  await admin.from("push_subscriptions").update({ is_active: false }).eq("user_id", user.id).eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
