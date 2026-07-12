import { createBillingCheckout } from "@/lib/billing/payments";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSiteUrl } from "@/lib/auth/site-url";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type PaymentDetails = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  city: string;
  country: string;
  operator: string;
};

const allowedOperators = new Set(["airtel_money", "orange_money", "mpesa", "afrimoney"]);

function cleanText(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizePhone(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!/^\d{8,15}$/.test(normalized)) return "";
  return normalized;
}

function parsePaymentDetails(raw: unknown): PaymentDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const details = {
    customerName: cleanText(obj.customerName, 100),
    customerEmail: cleanText(obj.customerEmail, 160).toLowerCase(),
    customerPhone: normalizePhone(obj.customerPhone),
    address: cleanText(obj.address, 200),
    city: cleanText(obj.city, 80),
    country: cleanText(obj.country, 80),
    operator: cleanText(obj.operator, 40),
  };
  if (!details.customerName || details.customerName.length < 2) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.customerEmail)) return null;
  if (!details.customerPhone) return null;
  if (!details.address || !details.city || !details.country) return null;
  if (!allowedOperators.has(details.operator)) return null;
  return details;
}

function parseCheckout(
  raw: unknown,
): { purpose: "subscription" | "credits" | "support_donation"; amount?: number; payment: PaymentDetails } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { purpose?: unknown; amount?: unknown; payment?: unknown };
  const payment = parsePaymentDetails(obj.payment);
  if (!payment) return null;
  const purpose = obj.purpose;
  if (purpose === "subscription" || purpose === "credits") return { purpose, payment };
  if (purpose === "support_donation") {
    const amount = typeof obj.amount === "number" ? obj.amount : Number(obj.amount);
    if (!Number.isFinite(amount)) return null;
    const cents = Math.round(amount * 100);
    if (cents < 500 || cents > 199900) return null;
    return { purpose, amount: cents, payment };
  }
  return null;
}

export async function POST(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });

  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });

  let parsed: { purpose: "subscription" | "credits" | "support_donation"; amount?: number; payment: PaymentDetails } | null = null;
  try {
    parsed = parseCheckout(await request.json());
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }
  if (!parsed) return NextResponse.json({ error: "purpose_invalide" }, { status: 400 });

  const checkout = await createBillingCheckout({
    admin,
    userId: user.id,
    userEmail: user.email ?? null,
    userPhone: user.phone ?? null,
    purpose: parsed.purpose,
    amount: parsed.amount,
    payment: parsed.payment,
    siteUrl: getSiteUrl(),
  });
  if (!checkout.ok) {
    const status = checkout.error === "provider_not_configured" ? 503 : 502;
    return NextResponse.json({ error: checkout.error, detail: checkout.detail }, { status });
  }

  return NextResponse.json({ ok: true, checkout_url: checkout.checkoutUrl });
}
