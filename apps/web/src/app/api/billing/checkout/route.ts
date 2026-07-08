import { createBillingCheckout } from "@/lib/billing/payments";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSiteUrl } from "@/lib/auth/site-url";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parsePurpose(raw: unknown): "subscription" | "credits" | null {
  if (!raw || typeof raw !== "object") return null;
  const purpose = (raw as { purpose?: unknown }).purpose;
  return purpose === "subscription" || purpose === "credits" ? purpose : null;
}

export async function POST(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });

  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });

  let purpose: "subscription" | "credits" | null = null;
  try {
    purpose = parsePurpose(await request.json());
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }
  if (!purpose) return NextResponse.json({ error: "purpose_invalide" }, { status: 400 });

  const checkout = await createBillingCheckout({
    admin,
    userId: user.id,
    purpose,
    siteUrl: getSiteUrl(),
  });
  if (!checkout.ok) {
    const status = checkout.error === "provider_not_configured" ? 503 : 502;
    return NextResponse.json({ error: checkout.error, detail: checkout.detail }, { status });
  }

  return NextResponse.json({ ok: true, checkout_url: checkout.checkoutUrl });
}
