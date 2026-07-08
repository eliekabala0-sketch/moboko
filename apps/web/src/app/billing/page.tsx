import { Masthead } from "@/components/layout/Masthead";
import { BillingCheckoutButtons } from "@/components/billing/BillingCheckoutButtons";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = {
  title: "Crédits et abonnement | Moboko",
  description: "Recharger des crédits ou souscrire un abonnement Moboko",
};

type PageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function BillingPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const from = sp.from?.trim();

  const supabase = await createSupabaseServerClient();
  let balance: number | null = null;
  let billingExempt = false;
  let isLoggedIn = false;
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      isLoggedIn = true;
      const { data: prof } = await supabase
        .from("profiles")
        .select("credit_balance, is_premium, is_free_access")
        .eq("id", user.id)
        .maybeSingle();
      if (prof) {
        balance = typeof prof.credit_balance === "number" ? prof.credit_balance : 0;
        billingExempt = Boolean(prof.is_premium || prof.is_free_access);
      }
      const { data: txs } = await supabase
        .from("payment_transactions")
        .select("id, purpose, status, amount, currency, credits, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8);
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

        {isLoggedIn ? (
          <div className="moboko-card mt-8 p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Votre solde</p>
            {billingExempt ? (
              <p className="mt-2 text-sm text-[var(--foreground)]">
                Votre compte bénéficie d’un accès sans débit de crédits (premium ou accès offert).
              </p>
            ) : (
              <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-[var(--foreground)]">
                {balance ?? 0}{" "}
                <span className="text-base font-normal text-[var(--muted)]">
                  crédit{(balance ?? 0) > 1 ? "s" : ""}
                </span>
              </p>
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
            <BillingCheckoutButtons disabled={!isLoggedIn} mode="credits" />
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
            <BillingCheckoutButtons disabled={!isLoggedIn} mode="subscription" />
          </div>
        </section>
        {isLoggedIn && transactions.length > 0 ? (
          <section className="scroll-mt-28 mt-12">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Historique</h2>
            <div className="moboko-card mt-5 divide-y divide-[var(--border)] p-2">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-[var(--foreground)]">
                      {tx.purpose === "credits" ? "Crédits IA" : "Abonnement"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {tx.created_at ? new Date(tx.created_at).toLocaleDateString("fr-FR") : ""}
                      {tx.credits ? ` · ${tx.credits} crédits` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums text-[var(--foreground)]">
                      {tx.amount ?? 0} {tx.currency ?? ""}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-wider text-[var(--muted)]">
                      {tx.status ?? "reçu"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
