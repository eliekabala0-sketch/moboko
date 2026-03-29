"use client";

import { updateUserBillingAction } from "@/app/admin/users/actions";
import type { AdminUserRow } from "@/lib/admin/users-data";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  row: AdminUserRow;
};

export function UserBillingRow({ row }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [credits, setCredits] = useState(String(row.credit_balance));
  const [premium, setPremium] = useState(row.is_premium);
  const [freeAccess, setFreeAccess] = useState(row.is_free_access);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      try {
        await updateUserBillingAction({
          userId: row.id,
          credit_balance: Number(credits),
          is_premium: premium,
          is_free_access: freeAccess,
        });
        setMsg("Enregistré");
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  return (
    <tr className="border-t border-[var(--border)] align-top text-sm transition hover:bg-[var(--surface)]/40">
      <td className="px-5 py-4 pr-3">
        <div className="font-mono text-[11px] text-[var(--muted)]">{row.id.slice(0, 8)}…</div>
        <div className="font-medium text-[var(--foreground)]">{row.email ?? "—"}</div>
        <div className="text-xs text-[var(--muted)]">{row.display_name ?? ""}</div>
      </td>
      <td className="px-5 py-4 pr-3">
        <input
          type="number"
          min={0}
          value={credits}
          onChange={(e) => setCredits(e.target.value)}
          className="moboko-input w-24 py-1.5 text-sm tabular-nums"
        />
      </td>
      <td className="px-5 py-4 pr-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-[var(--foreground)]">
          <input
            type="checkbox"
            checked={premium}
            onChange={(e) => setPremium(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface)] text-[var(--primary)]"
          />
          <span>Premium</span>
        </label>
      </td>
      <td className="px-5 py-4 pr-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-[var(--foreground)]">
          <input
            type="checkbox"
            checked={freeAccess}
            onChange={(e) => setFreeAccess(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface)] text-[var(--primary)]"
          />
          <span>Accès offert</span>
        </label>
      </td>
      <td className="px-5 py-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => save()}
          className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-elevated)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)]/35 disabled:opacity-50"
        >
          {pending ? "…" : "Appliquer"}
        </button>
        {msg ? (
          <span className="ml-2 text-xs font-medium text-[var(--success)]">{msg}</span>
        ) : null}
        {err ? <span className="ml-2 text-xs text-[var(--danger)]">{err}</span> : null}
      </td>
    </tr>
  );
}
