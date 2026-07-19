"use client";

import { useEffect, useState } from "react";

type StatusPayload = {
  ok?: boolean;
  status?: "none" | "pending" | "success" | "refused" | "expired" | "error";
  message?: string;
  raw_status?: string;
};

const LABELS: Record<string, string> = {
  pending: "Veuillez valider la transaction sur votre telephone.",
  success: "Paiement confirme.",
  refused: "Paiement refuse par l'operateur.",
  expired: "Paiement expire.",
  error: "Le fournisseur de paiement est indisponible.",
  none: "Aucun paiement recent.",
};

export function PaymentPendingStatus({ active }: { active: boolean }) {
  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timeout: number | null = null;
    async function poll() {
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        const data = (await res.json()) as StatusPayload;
        if (!cancelled) {
          setPayload(data);
          setTick((n) => n + 1);
        }
        if (!cancelled && (!data.status || data.status === "pending" || data.status === "none")) {
          timeout = window.setTimeout(poll, 4000);
        }
      } catch {
        if (!cancelled) timeout = window.setTimeout(poll, 6000);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [active]);

  if (!active) return null;
  const status = payload?.status ?? "pending";
  const isPending = status === "pending" || status === "none";
  const tone = status === "success" ? "success" : status === "refused" || status === "expired" || status === "error" ? "warning" : "success";
  const className =
    tone === "success"
      ? "moboko-card mt-6 border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-sm text-[var(--success)]"
      : "moboko-card mt-6 border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm text-[var(--foreground)]";

  return (
    <div className={className} role="status" aria-live="polite">
      <p className="font-semibold">{status === "success" ? "Paiement reussi" : status === "refused" ? "Paiement refuse" : status === "expired" ? "Paiement expire" : "Demande de paiement envoyee."}</p>
      <p className="mt-1">{payload?.message ?? LABELS[status] ?? LABELS.pending}</p>
      {isPending ? (
        <div className="mt-3 flex items-center gap-3 text-xs opacity-90">
          <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-current" />
          <span>Verification en cours{tick > 0 ? ` (${tick})` : ""}</span>
        </div>
      ) : null}
    </div>
  );
}
