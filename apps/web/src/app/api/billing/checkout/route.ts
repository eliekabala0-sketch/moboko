import { createBillingCheckout } from "@/lib/billing/payments";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSiteUrl } from "@/lib/auth/site-url";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseCheckout(raw: unknown): { purpose: "subscription" | "credits" | "support_donation"; amount?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { purpose?: unknown; amount?: unknown };
  const purpose = obj.purpose;
  if (purpose === "subscription" || purpose === "credits") return { purpose };
  if (purpose === "support_donation") {
    const amount = typeof obj.amount === "number" ? obj.amount : Number(obj.amount);
    if (!Number.isFinite(amount)) return null;
    const cents = Math.round(amount * 100);
    if (cents < 500 || cents > 199900) return null;
    return { purpose, amount: cents };
  }
  return null;
}

export async function POST(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });

  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });

  let parsed: { purpose: "subscription" | "credits" | "support_donation"; amount?: number } | null = null;
  try {
    parsed = parseCheckout(await request.json());
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }
  if (!parsed) return NextResponse.json({ error: "purpose_invalide" }, { status: 400 });

  const checkout = await createBillingCheckout({
    admin,
    userId: user.id,
    purpose: parsed.purpose,
    amount: parsed.amount,
    siteUrl: getSiteUrl(),
  });
  if (!checkout.ok) {
    const status = checkout.error === "provider_not_configured" ? 503 : 502;
    return NextResponse.json({ error: checkout.error, detail: checkout.detail }, { status });
  }

  return NextResponse.json({ ok: true, checkout_url: checkout.checkoutUrl });
}
