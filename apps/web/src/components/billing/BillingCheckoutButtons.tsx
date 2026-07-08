"use client";

import { useState } from "react";

type Purpose = "subscription" | "credits";

async function startCheckout(purpose: Purpose) {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose }),
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
  const [error, setError] = useState<string | null>(null);

  async function run(purpose: Purpose) {
    if (disabled || busy) return;
    setError(null);
    setBusy(purpose);
    try {
      await startCheckout(purpose);
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
            onClick={() => void run("credits")}
            className="moboko-btn-primary px-6 py-3 text-[14px] disabled:opacity-45"
          >
            {busy === "credits" ? "Preparation..." : "Acheter des credits"}
          </button>
        ) : null}
        {mode === "all" || mode === "subscription" ? (
          <button
            type="button"
            disabled={disabled || busy !== null}
            onClick={() => void run("subscription")}
            className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)]/40 disabled:opacity-45"
          >
            {busy === "subscription" ? "Preparation..." : "Souscrire"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-xl border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--foreground)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
