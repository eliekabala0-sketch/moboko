"use client";

import { useMemo, useState } from "react";

type Transaction = {
  id: string;
  purpose: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  credits: number | null;
  created_at: string | null;
};

function purposeLabel(purpose: string | null) {
  if (purpose === "credits") return "Credits IA";
  if (purpose === "support_donation") return "Soutien";
  return "Abonnement";
}

function statusLabel(status: string | null) {
  if (status === "paid" || status === "completed" || status === "success") return "Confirme";
  if (status === "pending") return "En attente";
  if (status === "cancelled") return "Annule";
  if (status === "failed") return "Refuse";
  if (status === "expired") return "Expire";
  if (status === "provider_unavailable") return "Provider indisponible";
  return "Recu";
}

export function TransactionHistory({ transactions }: { transactions: Transaction[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(() => (expanded ? transactions : transactions.slice(0, 5)), [expanded, transactions]);
  const hasMore = transactions.length > 5;

  return (
    <div className="moboko-card mt-5 divide-y divide-[var(--border)] p-2">
      {visible.map((tx) => (
        <div key={tx.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-[var(--foreground)]">{purposeLabel(tx.purpose)}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {tx.created_at ? new Date(tx.created_at).toLocaleDateString("fr-FR") : ""}
              {tx.credits ? ` · ${tx.credits} credit${tx.credits > 1 ? "s" : ""}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium tabular-nums text-[var(--foreground)]">
              {tx.amount ?? 0} {tx.currency ?? ""}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-[var(--muted)]">{statusLabel(tx.status)}</p>
          </div>
        </div>
      ))}
      {hasMore ? (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
          >
            {expanded ? "Reduire" : `Voir plus (${transactions.length - 5})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
