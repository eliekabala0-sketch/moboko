import { Masthead } from "@/components/layout/Masthead";
import { BillingCheckoutButtons } from "@/components/billing/BillingCheckoutButtons";
import { PaymentPendingStatus } from "@/components/billing/PaymentPendingStatus";
import { TransactionHistory } from "@/components/billing/TransactionHistory";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = {
  title: "Crédits et abonnement | Moboko",
  description: "Recharger des crédits ou souscrire un abonnement Moboko",
};

type PageProps = {
  searchParams: Promise<{ from?: string; status?: string }>;
};

export default async function BillingPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const from = sp.from?.trim();

  const supabase = await createSupabaseServerClient();
  let balance: number | null = null;
  let billingExempt = false;
  let isLoggedIn = false;
  let plans: {
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
  }[] = [];
  let packs: {
    id: string;
    name: string;
    description: string | null;
    credits: number;
    bonus_credits: number;
    price: number;
    currency: string;
    is_featured: boolean;
  }[] = [];
  let profile: { fullName: string | null; email: string | null; phone: string | null; city: string | null } | null = null;
  let transactions: {
    id: string;
    purpose: string | null;
    status: string | null;
    amount: number | null;
    currency: string | null;
    credits: number | null;
    created_at: string | null;
  }[] = [];

  if (supabase) {
    const [{ data: planRows }, { data: packRows }] = await Promise.all([
      supabase
        .from("billing_subscription_plans")
        .select(
          "id, name, description, user_visible_text, price, currency, duration_days, monthly_ai_credits, pdf_allowed, normal_search_unlimited, is_featured",
        )
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("billing_credit_packs")
        .select("id, name, description, credits, bonus_credits, price, currency, is_featured")
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    plans = planRows ?? [];
    packs = packRows ?? [];
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      isLoggedIn = true;
      const { data: prof } = await supabase
        .from("profiles")
.select("credit_balance, is_premium, is_free_access, full_name, phone, city")
        .eq("id", user.id)
        .maybeSingle();
      if (prof) {
        balance = typeof prof.credit_balance === "number" ? prof.credit_balance : 0;
        billingExempt = Boolean(prof.is_premium || prof.is_free_access);
        profile = {
          fullName: typeof prof.full_name === "string" ? prof.full_name : null,
          email: user.email ?? null,
          phone: typeof prof.phone === "string" ? prof.phone : null,
          city: typeof prof.city === "string" ? prof.city : null,
        };
      }
      const { data: txs } = await supabase
        .from("payment_transactions")
        .select("id, purpose, status, amount, currency, credits, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      transactions = txs ?? [];
    }
  }

  const backHref =
    from === "sermons-ai" ? "/sermons#recherche-ia" : from === "sermons" ? "/sermons" : "/";

  const backLabel =
    from === "sermons-ai" || from === "sermons" ? "← Retour aux sermons" : "← Accueil";

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
        <Link
          href={backHref}
          className="text-sm font-medium text-[var(--accent)] transition hover:text-[var(--foreground)]"
        >
          {backLabel}
        </Link>

        <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Compte
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Crédits et abonnement
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
          Les crédits servent aux fonctions assistées par IA (chat, recherche dans les sermons, etc.). Le paiement en
          ligne passe par un checkout sécurisé, puis l’activation est confirmée côté serveur.
        </p>

        {sp.status === "success" ? (
          <p className="moboko-card mt-6 border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-sm text-[var(--success)]">
            Paiement confirmé avec succès.
          </p>
        ) : null}
        <PaymentPendingStatus active={sp.status === "pending"} />
        {sp.status === "cancelled" ? (
          <p className="moboko-card mt-6 border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm text-[var(--foreground)]">
            Le paiement a été annulé ou refusé. Aucun montant n&apos;a été débité par Moboko.
          </p>
        ) : null}

        {isLoggedIn ? (
          <div className="moboko-card mt-8 p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Votre solde</p>
            {billingExempt ? (
              <p className="mt-2 text-sm text-[var(--foreground)]">
                Votre compte bénéficie d’un accès sans débit de crédits (premium ou accès offert).
              </p>
            ) : (
              <>
                <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-[var(--foreground)]">
                  {balance ?? 0}{" "}
                  <span className="text-base font-normal text-[var(--muted)]">
                    crédit{(balance ?? 0) > 1 ? "s" : ""}
                  </span>
                </p>
                {(balance ?? 0) === 0 ? (
                  <p className="mt-2 text-sm text-[var(--warning)]">Votre solde est épuisé.</p>
                ) : (balance ?? 0) <= 2 ? (
                  <p className="mt-2 text-sm text-[var(--warning)]">Votre solde est bas.</p>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="moboko-card mt-8 border-[var(--primary)]/25 bg-[var(--primary-soft)] p-6">
            <p className="text-sm text-[var(--foreground)]">
              Connectez-vous pour voir votre solde et, bientôt, recharger vos crédits en ligne.
            </p>
            <Link
              href="/auth?next=/billing"
              className="moboko-btn-primary mt-4 inline-flex px-6 py-3 text-[14px]"
            >
              Se connecter
            </Link>
          </div>
        )}

        <section id="credits" className="scroll-mt-28 mt-12">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Acheter des crédits</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            Rechargement séparé de l’abonnement. Les crédits sont ajoutés seulement après confirmation du paiement.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <BillingCheckoutButtons disabled={!isLoggedIn} mode="credits" packs={packs} profile={profile} />
          </div>
        </section>

        <section id="abonnements" className="scroll-mt-28 mt-12">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Abonnements</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            L’abonnement actif donne accès à la recherche normale illimitée et autorise les téléchargements PDF.
          </p>
          <ul className="moboko-card mt-5 list-inside list-disc space-y-2 p-6 text-sm text-[var(--muted)]">
            <li>Recherche normale illimitée pendant la période active.</li>
            <li>Téléchargement PDF réservé aux abonnés actifs.</li>
            <li>Crédits IA séparés, sauf crédits mensuels offerts par configuration admin.</li>
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <BillingCheckoutButtons disabled={!isLoggedIn} mode="subscription" plans={plans} profile={profile} />
          </div>
        </section>
        {isLoggedIn && transactions.length > 0 ? (
          <section className="scroll-mt-28 mt-12">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Historique</h2>
            <TransactionHistory transactions={transactions} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
