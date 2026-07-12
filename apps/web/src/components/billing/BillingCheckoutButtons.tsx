"use client";

import { useState } from "react";
import {
  CheckoutPaymentFields,
  DEFAULT_PAYMENT_DETAILS,
  MOBILE_MONEY_OPERATORS,
  type CheckoutPaymentDetails,
} from "@/components/billing/CheckoutPaymentFields";

type Purpose = "subscription" | "credits";

const PURPOSE_LABEL: Record<Purpose, string> = {
  subscription: "Souscription",
  credits: "Credits IA",
};

async function startCheckout(purpose: Purpose, payment: CheckoutPaymentDetails) {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose, payment }),
  });
  const data = (await res.json()) as { checkout_url?: string; error?: string };
  if (!res.ok || !data.checkout_url) {
    throw new Error(
      data.error === "provider_not_configured"
        ? "Paiement en ligne indisponible pour le moment."
        : "Impossible de preparer le paiement.",
    );
  }
  window.location.href = data.checkout_url;
}

export function BillingCheckoutButtons({
  disabled,
  mode = "all",
}: {
  disabled: boolean;
  mode?: "all" | Purpose;
}) {
  const [busy, setBusy] = useState<Purpose | null>(null);
  const [selected, setSelected] = useState<Purpose | null>(mode === "all" ? null : mode);
  const [payment, setPayment] = useState<CheckoutPaymentDetails>(DEFAULT_PAYMENT_DETAILS);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const purpose = selected;
    if (!purpose) {
      setError("Choisissez d'abord l'offre a payer.");
      return;
    }
    if (disabled || busy) return;
    setError(null);
    setBusy(purpose);
    try {
      await startCheckout(purpose, payment);
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
          <CheckoutPaymentFields value={payment} onChange={setPayment} disabled={disabled || busy !== null} />
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--foreground)]">
            <p className="font-semibold">Resume</p>
            <p className="mt-1 text-[var(--muted)]">
              {PURPOSE_LABEL[selected]} par{" "}
              {MOBILE_MONEY_OPERATORS.find((operator) => operator.value === payment.operator)?.label ?? "Mobile Money"}
              {payment.customerPhone ? ` - ${payment.customerPhone}` : ""}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled || busy !== null}
            onClick={() => void run()}
            className="moboko-btn-primary px-6 py-3 text-sm disabled:opacity-45"
          >
            {busy ? "Preparation..." : "Confirmer et payer"}
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
