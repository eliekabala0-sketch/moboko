import { SupportDonationCheckout } from "@/components/support/SupportDonationCheckout";
import { fetchPublicAppSettings } from "@/lib/data/public-app-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

async function submitSupportMessage(formData: FormData) {
  "use server";
  const message = String(formData.get("message") ?? "").trim();
  if (message.length < 3) redirect("/support?error=empty");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/support?error=service");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("support_messages").insert({
    user_id: user?.id ?? null,
    name: String(formData.get("name") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    subject: String(formData.get("subject") ?? "").trim() || null,
    message,
  });
  redirect(error ? "/support?error=submit" : "/support?sent=1");
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const settings = await fetchPublicAppSettings();
  const amounts = settings.supportSuggestedAmounts
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--overlay)] backdrop-blur-xl">
        <div className="mx-auto flex h-[4.25rem] max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="font-display text-lg font-semibold tracking-tight text-[var(--foreground)] transition hover:text-[var(--accent)]"
          >
            Moboko
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-[var(--muted)] sm:flex">
            {[
              { href: "/chat", label: "Assistant" },
              { href: "/sermons", label: "Sermons" },
              { href: "/projection", label: "Projection" },
              { href: "/posts", label: "Enseignements" },
              { href: "/requests", label: "Requetes" },
              { href: "/testimonies", label: "Temoignages" },
              { href: "/support", label: "Soutien" },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="transition-colors hover:text-[var(--foreground)]">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/auth"
              className="rounded-full px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
            >
              Connexion
            </Link>
            <Link href="/auth" className="moboko-btn-primary px-5 py-2 text-sm">
              Commencer
            </Link>
          </div>
        </div>
        <nav className="custom-scrollbar flex gap-2 overflow-x-auto border-t border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--muted)] sm:hidden">
          {[
            { href: "/chat", label: "Assistant" },
            { href: "/sermons", label: "Sermons" },
            { href: "/projection", label: "Projection" },
            { href: "/posts", label: "Enseignements" },
            { href: "/requests", label: "Requetes" },
            { href: "/testimonies", label: "Temoignages" },
            { href: "/support", label: "Soutien" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-1.5 transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Soutien
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
          Soutenir Moboko
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Le soutien est un don volontaire pour Moboko, sans service ni avantage attendu en retour.
        </p>

        {sp.status === "success" ? (
          <p className="moboko-card mt-6 border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-sm text-[var(--success)]">
            Merci. Votre don est en cours de confirmation.
          </p>
        ) : null}
        {sp.status === "cancelled" ? (
          <p className="moboko-card mt-6 border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm text-[var(--foreground)]">
            Le paiement n&apos;a pas ete finalise.
          </p>
        ) : null}

        {amounts.length > 0 ? (
          <SupportDonationCheckout
            amounts={amounts}
            allowOther={settings.supportOtherAmountEnabled}
            minAmount={settings.supportMinAmount}
            maxAmount={settings.supportMaxAmount}
          />
        ) : null}

        {settings.supportTeamContact ? (
          <p className="moboko-card mt-6 p-4 text-sm text-[var(--muted)]">
            Contact : <span className="text-[var(--foreground)]">{settings.supportTeamContact}</span>
          </p>
        ) : null}

        {sp.sent ? (
          <p className="moboko-card mt-6 border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-sm text-[var(--success)]">
            Message envoye.
          </p>
        ) : null}
        {sp.error ? (
          <p className="moboko-card mt-6 border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
            Envoi impossible pour le moment.
          </p>
        ) : null}

        <form action={submitSupportMessage} className="moboko-card mt-8 space-y-4 p-6">
          <input name="name" className="moboko-input" placeholder="Nom (optionnel)" />
          <input name="email" type="email" className="moboko-input" placeholder="Email (optionnel)" />
          <input name="subject" className="moboko-input" placeholder="Sujet (optionnel)" />
          <textarea
            name="message"
            required
            minLength={3}
            rows={7}
            className="moboko-input min-h-36 resize-y"
            placeholder="Votre message"
          />
          <button type="submit" className="moboko-btn-primary px-6 py-3 text-sm">
            Envoyer
          </button>
        </form>
      </main>
    </div>
  );
}
