import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPaymentCheckout,
  type CheckoutPurpose,
  type PaymentWebhookEvent,
} from "@/lib/billing/payment-provider";

export const BILLING_OFFERS = {
  subscription: {
    planKey: "pdf_monthly",
    amount: 500,
    currency: "USD",
  },
  credits: {
    credits: 20,
    amount: 300,
    currency: "USD",
  },
} as const;

export async function createBillingCheckout(opts: {
  admin: SupabaseClient;
  userId: string;
  userEmail?: string | null;
  userPhone?: string | null;
  purpose: CheckoutPurpose;
  siteUrl: string;
  amount?: number | null;
}) {
  const donationAmount =
    opts.purpose === "support_donation"
      ? Math.max(500, Math.min(199900, Math.floor(Number(opts.amount ?? 0))))
      : null;
  const offer =
    opts.purpose === "subscription"
      ? BILLING_OFFERS.subscription
      : opts.purpose === "credits"
        ? BILLING_OFFERS.credits
        : { amount: donationAmount ?? 500, currency: "USD" };
  const planKey = opts.purpose === "subscription" ? BILLING_OFFERS.subscription.planKey : null;
  const credits = opts.purpose === "credits" ? BILLING_OFFERS.credits.credits : null;
  const { data: tx, error } = await opts.admin
    .from("payment_transactions")
    .insert({
      user_id: opts.userId,
      provider: "badiboss_pay",
      amount: offer.amount,
      currency: offer.currency,
      status: "pending",
      purpose: opts.purpose,
      plan_key: planKey,
      credits,
      metadata: { source: "checkout_request", support_donation: opts.purpose === "support_donation" },
    })
    .select("id")
    .single();
  if (error || !tx?.id) throw new Error(error?.message ?? "transaction_creation_failed");

  const checkout = await createPaymentCheckout({
    transactionId: tx.id as string,
    userId: opts.userId,
    userEmail: opts.userEmail,
    userPhone: opts.userPhone,
    purpose: opts.purpose,
    amount: offer.amount,
    currency: offer.currency,
    planKey,
    credits,
    successUrl: `${opts.siteUrl}/${opts.purpose === "support_donation" ? "support" : "billing"}?status=success`,
    cancelUrl: `${opts.siteUrl}/${opts.purpose === "support_donation" ? "support" : "billing"}?status=cancelled`,
  });

  if (!checkout.ok) {
    await opts.admin
      .from("payment_transactions")
      .update({ status: "provider_unavailable", metadata: { provider_error: checkout } })
      .eq("id", tx.id as string);
    return checkout;
  }

  await opts.admin
    .from("payment_transactions")
    .update({
      external_id: checkout.externalId,
      checkout_url: checkout.checkoutUrl,
      metadata: { source: "checkout_request", checkout_created: true, support_donation: opts.purpose === "support_donation" },
    })
    .eq("id", tx.id as string);

  return checkout;
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
