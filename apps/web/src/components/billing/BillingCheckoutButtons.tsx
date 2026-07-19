"use client";

import { useState } from "react";
import {
  CheckoutPaymentFields,
  DEFAULT_PAYMENT_DETAILS,
  operatorLabel,
  paymentPayload,
  paymentPhoneLabel,
  type CheckoutPaymentDetails,
  type CheckoutProfile,
} from "@/components/billing/CheckoutPaymentFields";

type Purpose = "subscription" | "credits";

export type BillingPlanChoice = {
  id: string;
  name: string;
  description: string | null;
  user_visible_text: string | null;
  price: number;
  currency: string;
  duration_days: number;
  monthly_ai_credits: number;
  pdf_allowed: boolean;
  normal_search_unlimited: boolean;
  is_featured: boolean;
};

export type BillingCreditPackChoice = {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  bonus_credits: number;
  price: number;
  currency: string;
  is_featured: boolean;
};

const PURPOSE_LABEL: Record<Purpose, string> = {
  subscription: "Abonnement",
  credits: "Achat de credits",
};

async function startCheckout(args: {
  purpose: Purpose;
  payment: { operator: string; customerPhone: string };
  planId?: string | null;
  packId?: string | null;
  idempotencyKey: string;
}) {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = (await res.json()) as { checkout_url?: string; error?: string; message?: string };
  if (!res.ok || !data.checkout_url) {
    throw new Error(
      data.error === "provider_not_configured"
        ? "Paiement en ligne indisponible pour le moment."
        : data.message ?? "Le paiement n'a pas pu etre lance. Reessayez plus tard.",
    );
  }
  window.location.href = data.checkout_url;
}

export function BillingCheckoutButtons({
  disabled,
  mode = "all",
  plans = [],
  packs = [],
  profile = null,
}: {
  disabled: boolean;
  mode?: "all" | Purpose;
  plans?: BillingPlanChoice[];
  packs?: BillingCreditPackChoice[];
  profile?: CheckoutProfile | null;
}) {
  const [busy, setBusy] = useState<Purpose | null>(null);
  const [selected, setSelected] = useState<Purpose | null>(mode === "all" ? null : mode);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [packId, setPackId] = useState(packs[0]?.id ?? "");
  const [payment, setPayment] = useState<CheckoutPaymentDetails>(DEFAULT_PAYMENT_DETAILS);
  const [error, setError] = useState<string | null>(null);
  const selectedPlan = plans.find((plan) => plan.id === planId) ?? null;
  const selectedPack = packs.find((pack) => pack.id === packId) ?? null;
  const offerLabel =
    selected === "subscription" && selectedPlan
      ? selectedPlan.name
      : selected === "credits" && selectedPack
        ? selectedPack.name
        : "Offre a choisir";
  const selectedAmount =
    selected === "subscription" && selectedPlan
      ? `${selectedPlan.price} ${selectedPlan.currency}`
      : selected === "credits" && selectedPack
        ? `${selectedPack.price} ${selectedPack.currency}`
        : "";

  async function run() {
    const purpose = selected;
    if (!purpose) {
      setError("Choisissez d'abord l'offre a payer.");
      return;
    }
    if (purpose === "subscription" && !planId) {
      setError("Aucun abonnement n'est disponible pour le moment.");
      return;
    }
    if (purpose === "credits" && !packId) {
      setError("Aucun pack n'est disponible pour le moment.");
      return;
    }
    const payload = paymentPayload(payment, profile);
    if (!payload.customerPhone) {
      setError("Indiquez un numero Mobile Money pour lancer le paiement.");
      return;
    }
    if (disabled || busy) return;
    setError(null);
    setBusy(purpose);
    try {
      await startCheckout({
        purpose,
        payment: payload,
        planId: purpose === "subscription" ? planId : null,
        packId: purpose === "credits" ? packId : null,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Paiement indisponible.");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {mode === "all" || mode === "credits" ? (
          <button
            type="button"
            disabled={disabled || busy !== null}
            onClick={() => {
              setSelected("credits");
              setError(null);
            }}
            className="moboko-btn-primary px-6 py-3 text-[14px] disabled:opacity-45"
          >
            Acheter des credits
          </button>
        ) : null}
        {mode === "all" || mode === "subscription" ? (
          <button
            type="button"
            disabled={disabled || busy !== null}
            onClick={() => {
              setSelected("subscription");
              setError(null);
            }}
            className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)]/40 disabled:opacity-45"
          >
            Souscrire
          </button>
        ) : null}
      </div>
      {selected ? (
        <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {selected === "credits" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {packs.map((pack) => (
                <button
                  type="button"
                  key={pack.id}
                  disabled={disabled || busy !== null}
                  onClick={() => setPackId(pack.id)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm transition disabled:opacity-45 ${
                    packId === pack.id
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <span className="block font-semibold text-[var(--foreground)]">{pack.name}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {pack.credits + pack.bonus_credits} credits - {pack.price} {pack.currency}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {selected === "subscription" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {plans.map((plan) => (
                <button
                  type="button"
                  key={plan.id}
                  disabled={disabled || busy !== null}
                  onClick={() => setPlanId(plan.id)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm transition disabled:opacity-45 ${
                    planId === plan.id
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <span className="block font-semibold text-[var(--foreground)]">{plan.name}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {plan.price} {plan.currency} - {plan.duration_days} jours
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <CheckoutPaymentFields value={payment} onChange={setPayment} profile={profile} disabled={disabled || busy !== null} />
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--foreground)]">
            <p className="font-semibold">Resume</p>
            <p className="mt-2 text-[var(--muted)]">Offre : <span className="text-[var(--foreground)]">{offerLabel}</span></p>
            <p className="mt-1 text-[var(--muted)]">Montant : <span className="text-[var(--foreground)]">{selectedAmount}</span></p>
            <p className="mt-1 text-[var(--muted)]">Operateur : <span className="text-[var(--foreground)]">{operatorLabel(payment.operator)}</span></p>
            <p className="mt-1 text-[var(--muted)]">Numero : <span className="text-[var(--foreground)] tabular-nums">{paymentPhoneLabel(payment, profile)}</span></p>
            <p className="mt-2 text-xs text-[var(--muted)]">{PURPOSE_LABEL[selected]} confirme cote serveur apres validation Mobile Money.</p>
          </div>
          <button
            type="button"
            disabled={disabled || busy !== null}
            onClick={() => void run()}
            className="moboko-btn-primary px-6 py-3 text-sm disabled:opacity-45"
          >
            {busy ? "Preparation..." : "Confirmer le paiement"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--foreground)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
