"use client";

import { useMemo, useState } from "react";
import {
  CheckoutPaymentFields,
  DEFAULT_PAYMENT_DETAILS,
  MOBILE_MONEY_OPERATORS,
  type CheckoutPaymentDetails,
} from "@/components/billing/CheckoutPaymentFields";

function parseAmount(raw: string) {
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function startSupportCheckout(amount: number, payment: CheckoutPaymentDetails) {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose: "support_donation", amount, payment, idempotencyKey: crypto.randomUUID() }),
  });
  const data = (await res.json()) as { checkout_url?: string; error?: string; message?: string };
  if (!res.ok || !data.checkout_url) {
    throw new Error(data.message ?? "Le paiement n'a pas pu etre lance. Reessayez plus tard.");
  }
  window.location.href = data.checkout_url;
}

export function SupportDonationCheckout({
  amounts,
  allowOther = true,
  minAmount = 5,
  maxAmount = 1999,
}: {
  amounts: string[];
  allowOther?: boolean;
  minAmount?: number;
  maxAmount?: number;
}) {
  const normalized = useMemo(
    () =>
      amounts
        .map(parseAmount)
        .filter((n) => n >= minAmount && n <= maxAmount)
        .slice(0, 8),
    [amounts, maxAmount, minAmount],
  );
  const [selected, setSelected] = useState<number | null>(normalized[0] ?? null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [other, setOther] = useState("");
  const [payment, setPayment] = useState<CheckoutPaymentDetails>(DEFAULT_PAYMENT_DETAILS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = otherOpen ? parseAmount(other) : selected;
  const valid = chosen != null && chosen >= minAmount && chosen <= maxAmount;

  async function pay() {
    if (busy) return;
    setError(null);
    if (!valid || chosen == null) {
      setError(`Choisissez un montant entre ${minAmount} $ et ${maxAmount} $.`);
      return;
    }
    setBusy(true);
    try {
      await startSupportCheckout(chosen, payment);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Paiement indisponible.");
      setBusy(false);
    }
  }

  return (
    <div className="moboko-card mt-6 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
        Montants proposes
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {normalized.map((amount) => (
          <button
            type="button"
            key={amount}
            disabled={busy}
            onClick={() => {
              setSelected(amount);
              setOtherOpen(false);
              setError(null);
            }}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-45 ${
              !otherOpen && selected === amount
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            }`}
          >
            {amount} $
          </button>
        ))}
        {allowOther ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOtherOpen(true);
              setError(null);
            }}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-45 ${
              otherOpen
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            }`}
          >
            Autre montant
          </button>
        ) : null}
      </div>

      {otherOpen ? (
        <label className="mt-4 block text-sm font-medium text-[var(--foreground)]">
          <span className="text-[var(--muted)]">Montant entier</span>
          <input
            type="number"
            inputMode="numeric"
            min={minAmount}
            max={maxAmount}
            step={1}
            value={other}
            onChange={(e) => setOther(e.target.value)}
            className="moboko-input mt-2"
            placeholder={`${minAmount} a ${maxAmount}`}
            disabled={busy}
          />
        </label>
      ) : null}

      <div className="mt-4 space-y-4">
        <CheckoutPaymentFields value={payment} onChange={setPayment} disabled={busy} />
        {valid && chosen ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--foreground)]">
            <p className="font-semibold">Resume</p>
            <p className="mt-1 text-[var(--muted)]">
              Don de {chosen} $ par{" "}
              {MOBILE_MONEY_OPERATORS.find((operator) => operator.value === payment.operator)?.label ?? "Mobile Money"}
              {payment.customerPhone ? ` - ${payment.customerPhone}` : ""}
            </p>
          </div>
        ) : null}
        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => void pay()}
          className="moboko-btn-primary px-6 py-3 text-sm disabled:opacity-45"
        >
          {busy ? "Preparation..." : `Faire un don${valid && chosen ? ` de ${chosen} $` : ""}`}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
