import { requireAdmin } from "@/lib/admin/require-admin";
import Link from "next/link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--overlay)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link
              href="/"
              className="font-display text-sm font-semibold text-[var(--foreground)] hover:text-[var(--accent)]"
            >
              Moboko
            </Link>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Admin
            </span>
            <Link
              href="/admin/settings"
              className="text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
            >
              Paramètres
            </Link>
            <Link
              href="/admin/users"
              className="text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
            >
              Utilisateurs
            </Link>
          </div>
          <Link
            href="/"
            className="text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            Retour site
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-12">{children}</div>
    </div>
  );
}
