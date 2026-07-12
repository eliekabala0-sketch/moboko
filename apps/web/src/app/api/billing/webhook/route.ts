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

  const event = await parsePaymentWebhook(request, async (externalId) => {
    const byExternal = await admin
      .from("payment_transactions")
      .select("user_id, purpose, plan_key, credits")
      .eq("external_id", externalId)
      .maybeSingle();
    const byId = byExternal.data
      ? byExternal
      : await admin
          .from("payment_transactions")
          .select("user_id, purpose, plan_key, credits")
          .eq("id", externalId)
          .maybeSingle();
    const data = byId.data;
    if (!data) return null;
    const purpose = data.purpose;
    if (purpose !== "subscription" && purpose !== "credits" && purpose !== "support_donation") return null;
    return {
      userId: data.user_id as string,
      purpose,
      planKey: (data.plan_key as string | null) ?? null,
      credits: (data.credits as number | null) ?? null,
    };
  });
  if (!event) {
    return NextResponse.json({ error: "webhook_invalide" }, { status: 400 });
  }

  const applied = await applyPaymentWebhook(admin, event);
  if (!applied.ok) {
    return NextResponse.json({ error: "webhook_processing_failed", detail: applied.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, duplicate: applied.duplicate });
}
