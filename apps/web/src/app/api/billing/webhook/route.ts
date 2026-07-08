import { parsePaymentWebhook } from "@/lib/billing/payment-provider";
import { applyPaymentWebhook } from "@/lib/billing/payments";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  }

  const event = await parsePaymentWebhook(request);
  if (!event) {
    return NextResponse.json({ error: "webhook_invalide" }, { status: 400 });
  }

  const applied = await applyPaymentWebhook(admin, event);
  if (!applied.ok) {
    return NextResponse.json({ error: "webhook_processing_failed", detail: applied.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, duplicate: applied.duplicate });
}
