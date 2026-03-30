import { AuthForm } from "@/components/auth/AuthForm";
import Link from "next/link";
import { Suspense } from "react";

export default function AuthPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--overlay)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
          <Link
            href="/"
            className="font-display text-base font-semibold text-[var(--foreground)] hover:text-[var(--accent)]"
          >
            Moboko
          </Link>
          <Link href="/" className="text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]">
            Accueil
          </Link>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-14">
        <div className="mb-10 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
            Espace personnel
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            Accès Moboko
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
            Google, Apple, SMS ou e-mail — un seul compte Supabase, profil et crédits partagés.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="moboko-card mx-auto w-full max-w-md animate-pulse p-12 text-center text-sm text-[var(--muted)]">
              Chargement…
            </div>
          }
        >
          <AuthForm />
        </Suspense>
      </div>
    </div>
  );
}
