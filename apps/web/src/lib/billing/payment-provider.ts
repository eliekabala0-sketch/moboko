import crypto from "node:crypto";

export type PaymentProviderName = "badiboss_pay";
export type CheckoutPurpose = "subscription" | "credits" | "support_donation";

export type CheckoutRequest = {
  transactionId: string;
  userId: string;
  userEmail?: string | null;
  userPhone?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  operator?: string | null;
  purpose: CheckoutPurpose;
  amount: number;
  currency: string;
  planKey?: string | null;
  credits?: number | null;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult =
  | { ok: true; provider: PaymentProviderName; externalId: string; checkoutUrl: string; providerMs?: number }
  | { ok: false; error: "provider_not_configured" | "provider_error" | "duplicate_checkout"; detail?: string; providerMs?: number };

export type PaymentWebhookEvent =
  | {
      kind: "subscription_active";
      provider: PaymentProviderName;
      eventId: string;
      externalId: string;
      userId: string;
      planKey: string;
      amount: number | null;
      currency: string | null;
      currentPeriodEnd: string | null;
      raw: unknown;
    }
  | {
      kind: "credits_paid";
      provider: PaymentProviderName;
      eventId: string;
      externalId: string;
      userId: string;
      credits: number;
      amount: number | null;
      currency: string | null;
      raw: unknown;
    }
  | {
      kind: "support_donation_paid";
      provider: PaymentProviderName;
      eventId: string;
      externalId: string;
      userId: string;
      amount: number | null;
      currency: string | null;
      raw: unknown;
    }
  | {
      kind: "payment_recorded";
      provider: PaymentProviderName;
      eventId: string;
      externalId: string;
      userId: string;
      amount: number | null;
      currency: string | null;
      status: string;
      raw: unknown;
    };

function providerBaseUrl() {
  return process.env.BADIBOSS_PAY_API_URL?.trim() || "";
}

function providerSecret() {
  return process.env.BADIBOSS_PAY_WEBHOOK_SECRET?.trim() || "";
}

function providerApiKey() {
  return process.env.BADIBOSS_PAY_API_KEY?.trim() || "";
}

function providerApiSecret() {
  return process.env.BADIBOSS_PAY_API_SECRET?.trim() || "";
}

function providerAppId() {
  return process.env.BADIBOSS_PAY_APP_ID?.trim() || "";
}

function providerAppSlug() {
  return process.env.BADIBOSS_PAY_APP_SLUG?.trim() || "moboko";
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function asString(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

function asNumberOrNull(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() && Number.isFinite(Number(x))) return Number(x);
  return null;
}

function responseAmount(data: Record<string, unknown>, providerPayment: Record<string, unknown> | null) {
  return (
    asNumberOrNull(data.amount) ??
    asNumberOrNull(data.expected_amount) ??
    asNumberOrNull(data.provider_amount) ??
    asNumberOrNull(providerPayment?.amount) ??
    asNumberOrNull(providerPayment?.expectedAmount)
  );
}

function responseCurrency(data: Record<string, unknown>, providerPayment: Record<string, unknown> | null) {
  return (
    asString(data.currency) ||
    asString(data.expected_currency) ||
    asString(data.provider_currency) ||
    asString(providerPayment?.currency) ||
    asString(providerPayment?.expectedCurrency)
  ).toUpperCase();
}

function fallbackClientPhone(raw: string | null | undefined) {
  const t = typeof raw === "string" ? raw.trim() : "";
  return t.replace(/[^\d+]/g, "").replace(/^\+/, "") || "243990000000";
}

function fallbackClientName(raw: string | null | undefined, email: string | null | undefined) {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return "Moboko";
  if (!email) return t;
  const at = t.indexOf("@");
  return at > 0 ? t.slice(0, at) : t;
}

function verifyOptionalWebhookSignature(raw: string, request: Request): boolean {
  const secret = providerSecret();
  if (!secret) return false;

  const sharedSecret = request.headers.get("x-moboko-webhook-secret")?.trim();
  if (sharedSecret) {
    try {
      const left = Buffer.from(sharedSecret);
      const right = Buffer.from(secret);
      if (left.length === right.length && crypto.timingSafeEqual(left, right)) return true;
    } catch {
      return false;
    }
  }

  const signature = request.headers.get("x-badiboss-signature")?.trim();
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function createPaymentCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
  const startedAt = Date.now();
  const baseUrl = providerBaseUrl();
  const apiKey = providerApiKey();
  const apiSecret = providerApiSecret();
  const appId = providerAppId();
  const appSlug = providerAppSlug();
  if (!baseUrl || !apiKey || !apiSecret || !appId || !appSlug) {
    return { ok: false, error: "provider_not_configured", providerMs: Date.now() - startedAt };
  }

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
        "X-API-Secret": apiSecret,
        "X-Badiboss-API-Key": apiKey,
        "X-Badiboss-API-Secret": apiSecret,
        "X-Badiboss-App-Id": appId,
        "X-Badiboss-App-Slug": appSlug,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: appId,
        app_slug: appSlug,
        reference: req.transactionId,
        transaction_id: req.transactionId,
        user_id: req.userId,
        customer_id: req.userId,
        clientPhone: fallbackClientPhone(req.customerPhone ?? req.userPhone),
        clientEmail: req.customerEmail ?? req.userEmail ?? undefined,
        clientName: fallbackClientName(req.customerName ?? req.customerEmail ?? req.userEmail, req.customerEmail ?? req.userEmail),
        address: req.address ?? undefined,
        city: req.city ?? undefined,
        country: req.country ?? undefined,
        operator: req.operator ?? undefined,
        payment_operator: req.operator ?? undefined,
        purpose: req.purpose,
        amount: req.amount,
        currency: req.currency,
        plan_key: req.planKey ?? undefined,
        credits: req.credits ?? undefined,
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        metadata: {
          app_id: appId,
          app_slug: appSlug,
          transaction_id: req.transactionId,
          user_id: req.userId,
          purpose: req.purpose,
          plan_key: req.planKey ?? null,
          credits: req.credits ?? null,
          customer_name: req.customerName ?? null,
          customer_phone: req.customerPhone ?? null,
          customer_email: req.customerEmail ?? null,
          city: req.city ?? null,
          country: req.country ?? null,
          operator: req.operator ?? null,
        },
      }),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok || !isRecord(data)) {
      const detail = isRecord(data) ? JSON.stringify(data).slice(0, 600) : "";
      return { ok: false, error: "provider_error", detail: `HTTP ${res.status}${detail ? ` ${detail}` : ""}`, providerMs: Date.now() - startedAt };
    }
    const providerPayment =
      isRecord(data.provider_response) && isRecord(data.provider_response.payment)
        ? data.provider_response.payment
        : null;
    const externalId =
      asString(data.id) ||
      asString(data.external_id) ||
      asString(data.transaction_id) ||
      asString(providerPayment?.transactionId) ||
      req.transactionId;
    const echoedAmount = responseAmount(data, providerPayment);
    if (echoedAmount !== null && echoedAmount !== req.amount) {
      return { ok: false, error: "provider_error", detail: "montant_incoherent", providerMs: Date.now() - startedAt };
    }
    const echoedCurrency = responseCurrency(data, providerPayment);
    if (echoedCurrency && echoedCurrency !== req.currency.toUpperCase()) {
      return { ok: false, error: "provider_error", detail: "devise_incoherente", providerMs: Date.now() - startedAt };
    }
    const checkoutUrl = asString(data.checkout_url) || asString(data.url);
    if (!checkoutUrl && data.success === true && asString(data.status) === "pending") {
      return { ok: true, provider: "badiboss_pay", externalId, checkoutUrl: req.successUrl, providerMs: Date.now() - startedAt };
    }
    if (!checkoutUrl) {
      return { ok: false, error: "provider_error", detail: `checkout_url_absente ${JSON.stringify(data).slice(0, 600)}`, providerMs: Date.now() - startedAt };
    }
    return { ok: true, provider: "badiboss_pay", externalId, checkoutUrl, providerMs: Date.now() - startedAt };
  } catch (e) {
    return { ok: false, error: "provider_error", detail: e instanceof Error ? e.message : String(e), providerMs: Date.now() - startedAt };
  }
}

type TransactionLookup = {
  userId: string;
  purpose: CheckoutPurpose;
  planKey: string | null;
  credits: number | null;
} | null;

export async function parsePaymentWebhook(
  request: Request,
  lookupTransaction?: (externalId: string) => Promise<TransactionLookup>,
): Promise<PaymentWebhookEvent | null> {
  const raw = await request.text();
  if (!verifyOptionalWebhookSignature(raw, request)) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const eventId = asString(data.event_id) || asString(data.id);
  const type = asString(data.type) || asString(data.event);
  const status = asString(data.status);
  const externalId = asString(data.external_id) || asString(data.payment_id) || asString(data.reference);
  let userId = asString(data.user_id) || asString(data.metadata && isRecord(data.metadata) ? data.metadata.user_id : "");
  const amount = asNumberOrNull(data.amount);
  const currency = asString(data.currency) || null;
  if (!eventId || !externalId) return null;

  let purpose = asString(data.purpose) || asString(data.metadata && isRecord(data.metadata) ? data.metadata.purpose : "");
  let planKeyFromTx: string | null = null;
  let creditsFromTx: number | null = null;
  if ((!userId || !purpose) && lookupTransaction) {
    const tx = await lookupTransaction(externalId);
    if (tx) {
      userId = userId || tx.userId;
      purpose = purpose || tx.purpose;
      planKeyFromTx = tx.planKey;
      creditsFromTx = tx.credits;
    }
  }
  if (!userId || !purpose) return null;
  const paid = status === "paid" || status === "success" || status === "completed" || type.includes("paid");

  if (paid && purpose === "subscription") {
    const planKey =
      asString(data.plan_key) ||
      asString(data.metadata && isRecord(data.metadata) ? data.metadata.plan_key : "") ||
      planKeyFromTx ||
      "pdf_monthly";
    const currentPeriodEnd =
      asString(data.current_period_end) ||
      asString(data.period_end) ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    return {
      kind: "subscription_active",
      provider: "badiboss_pay",
      eventId,
      externalId,
      userId,
      planKey,
      amount,
      currency,
      currentPeriodEnd,
      raw: data,
    };
  }

  if (paid && purpose === "credits") {
    const credits = Math.max(
      0,
      Math.floor(
        asNumberOrNull(data.credits) ??
          asNumberOrNull(data.metadata && isRecord(data.metadata) ? data.metadata.credits : null) ??
          creditsFromTx ??
          0,
      ),
    );
    if (credits > 0) {
      return { kind: "credits_paid", provider: "badiboss_pay", eventId, externalId, userId, credits, amount, currency, raw: data };
    }
  }

  if (paid && purpose === "support_donation") {
    return {
      kind: "support_donation_paid",
      provider: "badiboss_pay",
      eventId,
      externalId,
      userId,
      amount,
      currency,
      raw: data,
    };
  }

  return {
    kind: "payment_recorded",
    provider: "badiboss_pay",
    eventId,
    externalId,
    userId,
    amount,
    currency,
    status: status || type || "received",
    raw: data,
  };
}
