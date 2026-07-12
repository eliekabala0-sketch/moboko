import { requireAdmin } from "@/lib/admin/require-admin";

export const metadata = {
  title: "Paiements | Admin Moboko",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR");
}

function formatMoney(amount: number | null, currency: string | null) {
  return `${amount ?? 0} ${currency ?? ""}`.trim();
}

function purposeLabel(purpose: string | null) {
  if (purpose === "credits") return "Crédits IA";
  if (purpose === "support_donation") return "Don de soutien";
  return "Abonnement";
}

export default async function AdminBillingPage() {
  const { supabase } = await requireAdmin();

  const [{ data: transactions }, { data: subscriptions }, { data: events }] = await Promise.all([
    supabase
      .from("payment_transactions")
      .select("id, user_id, purpose, status, amount, currency, credits, plan_key, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("subscriptions")
      .select("id, user_id, plan_key, status, current_period_end, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("payment_webhook_events")
      .select("id, event_type, status, error, created_at, processed_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <main>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Admin
      </p>
      <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
        Paiements et abonnements
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        Suivi serveur des transactions, abonnements et webhooks de paiement. Le prestataire reste isolé côté code.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Transactions récentes</h2>
        <div className="moboko-card mt-4 overflow-hidden">
          <div className="divide-y divide-[var(--border)]">
            {(transactions ?? []).map((tx) => (
              <div key={tx.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[1.3fr_1fr_1fr]">
                <div>
                  <p className="font-medium text-[var(--foreground)]">
                    {purposeLabel(tx.purpose)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{tx.user_id}</p>
                </div>
                <div className="text-[var(--muted)]">
                  <p>{formatMoney(tx.amount, tx.currency)}</p>
                  <p className="mt-1 text-xs">{tx.credits ? `${tx.credits} crédits` : tx.plan_key ?? "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]">
                    {tx.status ?? "reçu"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{formatDate(tx.completed_at ?? tx.created_at)}</p>
                </div>
              </div>
            ))}
            {(transactions ?? []).length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--muted)]">Aucune transaction.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Abonnements</h2>
        <div className="moboko-card mt-4 overflow-hidden">
          <div className="divide-y divide-[var(--border)]">
            {(subscriptions ?? []).map((sub) => (
              <div key={sub.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[1.4fr_1fr_1fr]">
                <div>
                  <p className="font-medium text-[var(--foreground)]">{sub.plan_key ?? "Abonnement"}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{sub.user_id}</p>
                </div>
                <p className="text-[var(--muted)]">{formatDate(sub.current_period_end)}</p>
                <p className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]">
                  {sub.status ?? "inconnu"}
                </p>
              </div>
            ))}
            {(subscriptions ?? []).length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--muted)]">Aucun abonnement.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Webhooks paiement</h2>
        <div className="moboko-card mt-4 overflow-hidden">
          <div className="divide-y divide-[var(--border)]">
            {(events ?? []).map((event) => (
              <div key={event.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[1.2fr_1fr_1fr]">
                <p className="font-medium text-[var(--foreground)]">{event.event_type}</p>
                <p className="text-[var(--muted)]">{event.error ?? formatDate(event.processed_at ?? event.created_at)}</p>
                <p className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]">
                  {event.status}
                </p>
              </div>
            ))}
            {(events ?? []).length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--muted)]">Aucun webhook reçu.</p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
