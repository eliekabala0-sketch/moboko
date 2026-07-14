import { PwaInstallButton } from "@/components/pwa/PwaInstallButton";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Installer Moboko",
  description: "Installer Moboko sur mobile ou ordinateur.",
};

export default function DownloadPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:py-14">
      <section className="grid gap-8 md:grid-cols-[1fr_0.9fr] md:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Moboko
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-[var(--foreground)] sm:text-5xl">
            Installer Moboko
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)]">
            Accedez rapidement a l&apos;Assistant, aux sermons, a la Bible, aux cantiques et a la projection depuis votre ecran d&apos;accueil.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <PwaInstallButton />
            <Link
              href="/chat"
              className="inline-flex rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)]/40"
            >
              Ouvrir Moboko
            </Link>
          </div>
        </div>

        <div className="moboko-card p-5 sm:p-6">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Installation</h2>
          <div className="mt-4 space-y-4 text-sm leading-6 text-[var(--muted)]">
            <p>
              Sur Android ou ordinateur, utilisez le bouton d&apos;installation lorsque le navigateur le propose.
            </p>
            <p>
              Sur iPhone, ouvrez le menu de partage de Safari puis ajoutez Moboko a l&apos;ecran d&apos;accueil.
            </p>
            <p>
              Si le bouton n&apos;est pas encore disponible, ouvrez Moboko dans Chrome, Edge ou Safari puis rechargez cette page.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
