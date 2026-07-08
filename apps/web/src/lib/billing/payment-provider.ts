import crypto from "node:crypto";

export type PaymentProviderName = "badiboss_pay";
export type CheckoutPurpose = "subscription" | "credits";

export type CheckoutRequest = {
  transactionId: string;
  userId: string;
  purpose: CheckoutPurpose;
  amount: number;
  currency: string;
  planKey?: string | null;
  credits?: number | null;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult =
  | { ok: true; provider: PaymentProviderName; externalId: string; checkoutUrl: string }
  | { ok: false; error: "provider_not_configured" | "provider_error"; detail?: string };

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
  const baseUrl = providerBaseUrl();
  const apiKey = providerApiKey();
  if (!baseUrl || !apiKey) return { ok: false, error: "provider_not_configured" };

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reference: req.transactionId,
        user_id: req.userId,
        purpose: req.purpose,
        amount: req.amount,
        currency: req.currency,
        plan_key: req.planKey ?? undefined,
        credits: req.credits ?? undefined,
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
      }),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok || !isRecord(data)) {
      return { ok: false, error: "provider_error", detail: `HTTP ${res.status}` };
    }
    const externalId = asString(data.id) || asString(data.external_id) || req.transactionId;
    const checkoutUrl = asString(data.checkout_url) || asString(data.url);
    if (!checkoutUrl) return { ok: false, error: "provider_error", detail: "checkout_url_absente" };
    return { ok: true, provider: "badiboss_pay", externalId, checkoutUrl };
  } catch (e) {
    return { ok: false, error: "provider_error", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function parsePaymentWebhook(request: Request): Promise<PaymentWebhookEvent | null> {
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
  const userId = asString(data.user_id) || asString(data.metadata && isRecord(data.metadata) ? data.metadata.user_id : "");
  const amount = asNumberOrNull(data.amount);
  const currency = asString(data.currency) || null;
  if (!eventId || !externalId || !userId) return null;

  const purpose = asString(data.purpose) || asString(data.metadata && isRecord(data.metadata) ? data.metadata.purpose : "");
  const paid = status === "paid" || status === "success" || status === "completed" || type.includes("paid");

  if (paid && purpose === "subscription") {
    const planKey = asString(data.plan_key) || asString(data.metadata && isRecord(data.metadata) ? data.metadata.plan_key : "") || "pdf_monthly";
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
    const credits = Math.max(0, Math.floor(asNumberOrNull(data.credits) ?? asNumberOrNull(data.metadata && isRecord(data.metadata) ? data.metadata.credits : null) ?? 0));
    if (credits > 0) {
      return { kind: "credits_paid", provider: "badiboss_pay", eventId, externalId, userId, credits, amount, currency, raw: data };
    }
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
