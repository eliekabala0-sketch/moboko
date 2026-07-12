import { requireAdmin } from "@/lib/admin/require-admin";
import { saveCreditPackAction, saveSubscriptionPlanAction } from "./actions";

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

  const [{ data: transactions }, { data: subscriptions }, { data: events }, { data: plans }, { data: packs }] = await Promise.all([
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
    supabase
      .from("billing_subscription_plans")
      .select(
        "id, plan_key, name, description, user_visible_text, price, currency, duration_days, monthly_ai_credits, export_limit, normal_search_unlimited, pdf_allowed, is_active, is_featured, display_order",
      )
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("billing_credit_packs")
      .select("id, pack_key, name, description, credits, bonus_credits, price, currency, is_active, is_featured, display_order")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true }),
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
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Plans d&apos;abonnement</h2>
        <div className="mt-4 grid gap-4">
          {[...(plans ?? []), null].map((plan, index) => (
            <form key={plan?.id ?? "new-plan"} action={saveSubscriptionPlanAction} className="moboko-card grid gap-3 p-4 text-sm md:grid-cols-4">
              <input type="hidden" name="id" defaultValue={plan?.id ?? ""} />
              <input name="name" className="moboko-input" placeholder="Nom" defaultValue={plan?.name ?? ""} required />
              <input name="price" className="moboko-input" type="number" min={1} placeholder="Prix" defaultValue={plan?.price ?? ""} required />
              <input name="currency" className="moboko-input" placeholder="Devise" defaultValue={plan?.currency ?? "USD"} />
              <input name="duration_days" className="moboko-input" type="number" min={1} placeholder="Jours" defaultValue={plan?.duration_days ?? 30} />
              <input name="plan_key" className="moboko-input" placeholder="Cle interne" defaultValue={plan?.plan_key ?? ""} />
              <input name="monthly_ai_credits" className="moboko-input" type="number" min={0} placeholder="Credits IA mensuels" defaultValue={plan?.monthly_ai_credits ?? 0} />
              <input name="export_limit" className="moboko-input" type="number" min={0} placeholder="Exports" defaultValue={plan?.export_limit ?? ""} />
              <input name="display_order" className="moboko-input" type="number" min={0} placeholder="Ordre" defaultValue={plan?.display_order ?? index + 10} />
              <textarea name="description" className="moboko-input md:col-span-2" rows={2} placeholder="Description" defaultValue={plan?.description ?? ""} />
              <textarea name="user_visible_text" className="moboko-input md:col-span-2" rows={2} placeholder="Texte visible utilisateur" defaultValue={plan?.user_visible_text ?? ""} />
              <textarea name="benefits" className="moboko-input md:col-span-4" rows={2} placeholder="Avantages, un par ligne" defaultValue="" />
              <label className="flex items-center gap-2 text-[var(--muted)]">
                <input name="normal_search_unlimited" type="checkbox" defaultChecked={plan?.normal_search_unlimited ?? true} />
                Recherche illimitee
              </label>
              <label className="flex items-center gap-2 text-[var(--muted)]">
                <input name="pdf_allowed" type="checkbox" defaultChecked={plan?.pdf_allowed ?? true} />
                PDF
              </label>
              <label className="flex items-center gap-2 text-[var(--muted)]">
                <input name="is_featured" type="checkbox" defaultChecked={plan?.is_featured ?? false} />
                Mis en avant
              </label>
              <label className="flex items-center gap-2 text-[var(--muted)]">
                <input name="is_active" type="checkbox" defaultChecked={plan?.is_active ?? true} />
                Actif
              </label>
              <button type="submit" className="moboko-btn-primary px-4 py-2 text-sm md:col-span-4">
                {plan ? "Enregistrer ce plan" : "Ajouter le plan"}
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Packs de crédits</h2>
        <div className="mt-4 grid gap-4">
          {[...(packs ?? []), null].map((pack, index) => (
            <form key={pack?.id ?? "new-pack"} action={saveCreditPackAction} className="moboko-card grid gap-3 p-4 text-sm md:grid-cols-4">
              <input type="hidden" name="id" defaultValue={pack?.id ?? ""} />
              <input name="name" className="moboko-input" placeholder="Nom" defaultValue={pack?.name ?? ""} required />
              <input name="credits" className="moboko-input" type="number" min={1} placeholder="Credits" defaultValue={pack?.credits ?? ""} required />
              <input name="bonus_credits" className="moboko-input" type="number" min={0} placeholder="Bonus" defaultValue={pack?.bonus_credits ?? 0} />
              <input name="price" className="moboko-input" type="number" min={1} placeholder="Prix" defaultValue={pack?.price ?? ""} required />
              <input name="currency" className="moboko-input" placeholder="Devise" defaultValue={pack?.currency ?? "USD"} />
              <input name="pack_key" className="moboko-input" placeholder="Cle interne" defaultValue={pack?.pack_key ?? ""} />
              <input name="display_order" className="moboko-input" type="number" min={0} placeholder="Ordre" defaultValue={pack?.display_order ?? index + 10} />
              <textarea name="description" className="moboko-input md:col-span-4" rows={2} placeholder="Description" defaultValue={pack?.description ?? ""} />
              <label className="flex items-center gap-2 text-[var(--muted)]">
                <input name="is_featured" type="checkbox" defaultChecked={pack?.is_featured ?? false} />
                Mis en avant
              </label>
              <label className="flex items-center gap-2 text-[var(--muted)]">
                <input name="is_active" type="checkbox" defaultChecked={pack?.is_active ?? true} />
                Actif
              </label>
              <button type="submit" className="moboko-btn-primary px-4 py-2 text-sm md:col-span-4">
                {pack ? "Enregistrer ce pack" : "Ajouter le pack"}
              </button>
            </form>
          ))}
        </div>
      </section>

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
