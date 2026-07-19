import { createBillingCheckout } from "@/lib/billing/payments";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSiteUrl } from "@/lib/auth/site-url";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type PaymentInput = {
  operator: string;
  customerPhone: string | null;
};

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

function parsePaymentInput(raw: unknown): PaymentInput | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const operator = cleanText(obj.operator, 40);
  if (!allowedOperators.has(operator)) return null;
  return {
    operator,
    customerPhone: normalizePhone(obj.customerPhone) || null,
  };
}

function usableEmail(value: string | null | undefined) {
  const email = cleanText(value, 160).toLowerCase();
  if (!email || email.includes("@phone.moboko.local")) return "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "";
}

function displayNameFromEmail(email: string) {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

async function paymentDetailsFromProfile(opts: {
  admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>;
  userId: string;
  userEmail: string | null | undefined;
  userPhone: string | null | undefined;
  input: PaymentInput;
}): Promise<PaymentDetails | null> {
  const { data: profile } = await opts.admin
    .from("profiles")
    .select("full_name, display_name, city, phone")
    .eq("id", opts.userId)
    .maybeSingle();

  const email = usableEmail(opts.userEmail);
  const customerName =
    cleanText(profile?.full_name, 100) ||
    cleanText(profile?.display_name, 100) ||
    (email ? displayNameFromEmail(email) : "Utilisateur Moboko");
  const profilePhone = normalizePhone(profile?.phone);
  const authPhone = normalizePhone(opts.userPhone);
  const customerPhone = opts.input.customerPhone || profilePhone || authPhone;
  if (!customerPhone) return null;

  return {
    customerName,
    customerEmail: email,
    customerPhone,
    address: "Profil Moboko",
    city: cleanText(profile?.city, 80) || "Kinshasa",
    country: "RDC",
    operator: opts.input.operator,
  };
}

function parseCheckout(
  raw: unknown,
): {
  purpose: "subscription" | "credits" | "support_donation";
  amount?: number;
  planId?: string | null;
  packId?: string | null;
  idempotencyKey?: string | null;
  returnUrl?: string | null;
  payment: PaymentInput;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as {
    purpose?: unknown;
    amount?: unknown;
    planId?: unknown;
    packId?: unknown;
    idempotencyKey?: unknown;
    returnUrl?: unknown;
    payment?: unknown;
  };
  const payment = parsePaymentInput(obj.payment);
  if (!payment) return null;
  const purpose = obj.purpose;
  const idempotencyKey = cleanText(obj.idempotencyKey, 80) || null;
  const returnUrlRaw = cleanText(obj.returnUrl, 240);
  const returnUrl = returnUrlRaw.startsWith("moboko://") ? returnUrlRaw : null;
  if (purpose === "subscription") {
    const planId = cleanText(obj.planId, 80);
    if (!planId) return null;
    return { purpose, planId, idempotencyKey, returnUrl, payment };
  }
  if (purpose === "credits") {
    const packId = cleanText(obj.packId, 80);
    if (!packId) return null;
    return { purpose, packId, idempotencyKey, returnUrl, payment };
  }
  if (purpose === "support_donation") {
    const amount = typeof obj.amount === "number" ? obj.amount : Number(obj.amount);
    if (!Number.isFinite(amount)) return null;
    const dollars = Math.floor(amount);
    if (dollars < 5 || dollars > 1999 || dollars !== amount) return null;
    return { purpose, amount: dollars, idempotencyKey, returnUrl, payment };
  }
  return null;
}

export async function POST(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });

  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });

  let parsed: {
    purpose: "subscription" | "credits" | "support_donation";
    amount?: number;
    planId?: string | null;
    packId?: string | null;
    idempotencyKey?: string | null;
    returnUrl?: string | null;
    payment: PaymentInput;
  } | null = null;
  try {
    parsed = parseCheckout(await request.json());
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }
  if (!parsed) return NextResponse.json({ error: "purpose_invalide" }, { status: 400 });

  const payment = await paymentDetailsFromProfile({
    admin,
    userId: user.id,
    userEmail: user.email ?? null,
    userPhone: user.phone ?? null,
    input: parsed.payment,
  });
  if (!payment) {
    return NextResponse.json(
      { error: "numero_paiement_requis", message: "Ajoutez un numero Mobile Money dans votre profil ou indiquez un autre numero." },
      { status: 400 },
    );
  }

  const checkout = await createBillingCheckout({
    admin,
    userId: user.id,
    userEmail: user.email ?? null,
    userPhone: user.phone ?? null,
    purpose: parsed.purpose,
    amount: parsed.amount,
    planId: parsed.planId,
    packId: parsed.packId,
    idempotencyKey: parsed.idempotencyKey,
    payment,
    successUrl: parsed.returnUrl ? `${parsed.returnUrl}?status=pending` : null,
    cancelUrl: parsed.returnUrl ? `${parsed.returnUrl}?status=cancelled` : null,
    siteUrl: getSiteUrl(),
  });
  if (!checkout.ok) {
    const status =
      checkout.error === "provider_not_configured"
        ? 503
        : checkout.error === "duplicate_checkout"
          ? 409
          : 502;
    const message =
      checkout.error === "duplicate_checkout"
        ? "Une demande est deja en cours pour cette action."
        : checkout.detail === "montant_incoherent" || checkout.detail === "devise_incoherente"
          ? "Le paiement n'a pas pu etre lance. Reessayez plus tard."
          : checkout.error === "provider_not_configured"
            ? "Paiement en ligne indisponible pour le moment."
            : "Le paiement n'a pas pu etre lance. Reessayez plus tard.";
    return NextResponse.json({ error: checkout.error, message }, { status });
  }

  return NextResponse.json({ ok: true, checkout_url: checkout.checkoutUrl });
}
