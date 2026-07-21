import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import {
  createPaymentCheckout,
  type CheckoutPurpose,
  type PaymentWebhookEvent,
} from "@/lib/billing/payment-provider";

export type CheckoutPaymentDetails = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  city: string;
  country: string;
  operator: string;
};

type BillingOffer =
  | {
      kind: "subscription";
      offerId: string;
      planKey: string;
      amount: number;
      currency: string;
      durationDays: number;
      monthlyAiCredits: number;
      credits: null;
    }
  | {
      kind: "credits";
      offerId: string;
      planKey: null;
      amount: number;
      currency: string;
      durationDays: null;
      monthlyAiCredits: null;
      credits: number;
    }
  | {
      kind: "support_donation";
      offerId: null;
      planKey: null;
      amount: number;
      currency: string;
      durationDays: null;
      monthlyAiCredits: null;
      credits: null;
    };

function asPositiveInt(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function asCurrency(value: unknown) {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  return currency || "USD";
}

async function resolveOffer(opts: {
  admin: SupabaseClient;
  purpose: CheckoutPurpose;
  planId?: string | null;
  packId?: string | null;
  amount?: number | null;
}): Promise<BillingOffer> {
  if (opts.purpose === "subscription") {
    if (!opts.planId) throw new Error("offre_indisponible");
    const { data, error } = await opts.admin
      .from("billing_subscription_plans")
      .select("id, plan_key, price, currency, duration_days, monthly_ai_credits, is_active")
      .eq("id", opts.planId)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) throw new Error("offre_indisponible");
    const amount = asPositiveInt(data.price);
    if (amount <= 0) throw new Error("montant_invalide");
    return {
      kind: "subscription",
      offerId: data.id as string,
      planKey: String(data.plan_key),
      amount,
      currency: asCurrency(data.currency),
      durationDays: Math.max(1, asPositiveInt(data.duration_days)),
      monthlyAiCredits: asPositiveInt(data.monthly_ai_credits),
      credits: null,
    };
  }

  if (opts.purpose === "credits") {
    if (!opts.packId) throw new Error("offre_indisponible");
    const { data, error } = await opts.admin
      .from("billing_credit_packs")
      .select("id, credits, bonus_credits, price, currency, is_active")
      .eq("id", opts.packId)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) throw new Error("offre_indisponible");
    const amount = asPositiveInt(data.price);
    const credits = asPositiveInt(data.credits) + asPositiveInt(data.bonus_credits);
    if (amount <= 0 || credits <= 0) throw new Error("montant_invalide");
    return {
      kind: "credits",
      offerId: data.id as string,
      planKey: null,
      amount,
      currency: asCurrency(data.currency),
      durationDays: null,
      monthlyAiCredits: null,
      credits,
    };
  }

  const amount = asPositiveInt(opts.amount);
  if (amount < 5 || amount > 1999) throw new Error("montant_invalide");
  return {
    kind: "support_donation",
    offerId: null,
    planKey: null,
    amount,
    currency: "USD",
    durationDays: null,
    monthlyAiCredits: null,
    credits: null,
  };
}

export async function createBillingCheckout(opts: {
  admin: SupabaseClient;
  userId: string;
  userEmail?: string | null;
  userPhone?: string | null;
  purpose: CheckoutPurpose;
  siteUrl: string;
  amount?: number | null;
  planId?: string | null;
  packId?: string | null;
  idempotencyKey?: string | null;
  payment: CheckoutPaymentDetails;
  successUrl?: string | null;
  cancelUrl?: string | null;
}) {
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const offer = await resolveOffer({
    admin: opts.admin,
    purpose: opts.purpose,
    planId: opts.planId,
    packId: opts.packId,
    amount: opts.amount,
  });
  timings.resolve_offer_ms = Date.now() - startedAt;
  const idempotencyKey = opts.idempotencyKey?.trim() || crypto.randomUUID();
  const insertStarted = Date.now();
  const { data: tx, error } = await opts.admin
    .from("payment_transactions")
    .insert({
      user_id: opts.userId,
      provider: "badiboss_pay",
      amount: offer.amount,
      currency: offer.currency,
      status: "pending",
      purpose: opts.purpose,
      plan_key: offer.planKey,
      credits: offer.credits,
      offer_id: offer.offerId,
      idempotency_key: idempotencyKey,
      metadata: {
        source: "checkout_request",
        support_donation: opts.purpose === "support_donation",
        offer_kind: offer.kind,
        amount: offer.amount,
        currency: offer.currency,
        duration_days: offer.durationDays,
        monthly_ai_credits: offer.monthlyAiCredits,
        customer_name: opts.payment.customerName,
        customer_email: opts.payment.customerEmail,
        customer_phone: opts.payment.customerPhone,
        address: opts.payment.address,
        city: opts.payment.city,
        country: opts.payment.country,
        operator: opts.payment.operator,
      },
    })
    .select("id")
    .single();
  timings.transaction_insert_ms = Date.now() - insertStarted;
  if (error?.code === "23505") {
    return { ok: false as const, error: "duplicate_checkout" as const, timings };
  }
  if (error || !tx?.id) throw new Error(error?.message ?? "transaction_creation_failed");

  const providerStarted = Date.now();
  const checkout = await createPaymentCheckout({
    transactionId: tx.id as string,
    userId: opts.userId,
    userEmail: opts.userEmail,
    userPhone: opts.userPhone,
    customerName: opts.payment.customerName,
    customerEmail: opts.payment.customerEmail,
    customerPhone: opts.payment.customerPhone,
    address: opts.payment.address,
    city: opts.payment.city,
    country: opts.payment.country,
    operator: opts.payment.operator,
    purpose: opts.purpose,
    amount: offer.amount,
    currency: offer.currency,
    planKey: offer.planKey,
    credits: offer.credits,
    successUrl: opts.successUrl || `${opts.siteUrl}/${opts.purpose === "support_donation" ? "support" : "billing"}?status=pending`,
    cancelUrl: opts.cancelUrl || `${opts.siteUrl}/${opts.purpose === "support_donation" ? "support" : "billing"}?status=cancelled`,
  });
  timings.provider_call_ms = checkout.providerMs ?? Date.now() - providerStarted;

  if (!checkout.ok) {
    const updateStarted = Date.now();
    await opts.admin
      .from("payment_transactions")
      .update({ status: "provider_unavailable", metadata: { provider_error: checkout, timings } })
      .eq("id", tx.id as string);
    timings.transaction_update_ms = Date.now() - updateStarted;
    timings.total_ms = Date.now() - startedAt;
    return { ...checkout, timings };
  }

  const updateStarted = Date.now();
  await opts.admin
    .from("payment_transactions")
    .update({
      external_id: checkout.externalId,
      checkout_url: checkout.checkoutUrl,
      provider_amount: offer.amount,
      provider_currency: offer.currency,
      metadata: {
        source: "checkout_request",
        checkout_created: true,
        support_donation: opts.purpose === "support_donation",
        offer_kind: offer.kind,
        amount: offer.amount,
        currency: offer.currency,
        duration_days: offer.durationDays,
        monthly_ai_credits: offer.monthlyAiCredits,
        customer_name: opts.payment.customerName,
        customer_email: opts.payment.customerEmail,
        customer_phone: opts.payment.customerPhone,
        address: opts.payment.address,
        city: opts.payment.city,
        country: opts.payment.country,
        operator: opts.payment.operator,
        timings,
      },
    })
    .eq("id", tx.id as string);
  timings.transaction_update_ms = Date.now() - updateStarted;
  timings.total_ms = Date.now() - startedAt;

  return { ...checkout, timings };
}

export async function applyPaymentWebhook(admin: SupabaseClient, event: PaymentWebhookEvent) {
  const { data: recorded, error: recordErr } = await admin
    .from("payment_webhook_events")
    .insert({
      provider: event.provider,
      event_id: event.eventId,
      event_type: event.kind,
      status: "received",
      payload: event.raw,
    })
    .select("id")
    .maybeSingle();

  if (recordErr?.code === "23505") {
    return { ok: true, duplicate: true };
  }
  if (recordErr || !recorded?.id) {
    return { ok: false, duplicate: false, error: recordErr?.message ?? "webhook_record_failed" };
  }

  try {
    if (event.kind === "subscription_active") {
      const { data: sub, error: subErr } = await admin
        .from("subscriptions")
        .upsert(
          {
            user_id: event.userId,
            plan_key: event.planKey,
            status: "active",
            provider: event.provider,
            external_id: event.externalId,
            current_period_end: event.currentPeriodEnd,
            metadata: { source: "payment_webhook", event_id: event.eventId },
          },
          { onConflict: "provider,external_id" },
        )
        .select("id")
        .single();
      if (subErr) throw subErr;

      await admin
        .from("payment_transactions")
        .update({
          status: "paid",
          provider_event_id: event.eventId,
          completed_at: new Date().toISOString(),
          plan_key: event.planKey,
          metadata: { source: "payment_webhook", subscription_id: sub?.id ?? null },
        })
        .eq("provider", event.provider)
        .eq("external_id", event.externalId);
    } else if (event.kind === "credits_paid") {
      const { data: profile } = await admin
        .from("profiles")
        .select("credit_balance")
        .eq("id", event.userId)
        .single();
      const balance = typeof profile?.credit_balance === "number" ? profile.credit_balance : 0;
      const next = balance + event.credits;

      await admin.from("profiles").update({ credit_balance: next }).eq("id", event.userId);
      await admin.from("credit_logs").insert({
        user_id: event.userId,
        delta: event.credits,
        balance_after: next,
        reason: "credit_purchase",
        ref_type: "payment",
        ref_id: null,
      });
      await admin
        .from("payment_transactions")
        .update({
          status: "paid",
          provider_event_id: event.eventId,
          completed_at: new Date().toISOString(),
          credits: event.credits,
          metadata: { source: "payment_webhook", credits: event.credits },
        })
        .eq("provider", event.provider)
        .eq("external_id", event.externalId);
    } else if (event.kind === "support_donation_paid") {
      await admin
        .from("payment_transactions")
        .update({
          status: "paid",
          provider_event_id: event.eventId,
          completed_at: new Date().toISOString(),
          metadata: { source: "payment_webhook", support_donation: true },
        })
        .eq("provider", event.provider)
        .eq("external_id", event.externalId);
    } else {
      await admin
        .from("payment_transactions")
        .update({ status: event.status, provider_event_id: event.eventId })
        .eq("provider", event.provider)
        .eq("external_id", event.externalId);
    }

    await admin
      .from("payment_webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", recorded.id as string);
    return { ok: true, duplicate: false };
  } catch (e) {
    await admin
      .from("payment_webhook_events")
      .update({ status: "failed", error: e instanceof Error ? e.message : String(e) })
      .eq("id", recorded.id as string);
    return { ok: false, duplicate: false, error: e instanceof Error ? e.message : String(e) };
  }
}
