import { SignOutButton } from "@/components/auth/SignOutButton";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

const nav = [
  { href: "/chat", label: "Assistant" },
  { href: "/posts", label: "Enseignements" },
  { href: "/sermons", label: "Sermons" },
  { href: "/projection", label: "Projection" },
];

export async function Masthead() {
  const supabase = await createSupabaseServerClient();
  let email: string | null = null;
  let isAdmin = false;
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    email = user?.email ?? null;
    if (user) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      isAdmin = prof?.role === "admin";
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--overlay)] backdrop-blur-xl">
      <div className="mx-auto flex h-[4.25rem] max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tight text-[var(--foreground)] transition hover:text-[var(--accent)]"
        >
          Moboko
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-[var(--muted)] sm:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-[var(--foreground)]"
            >
              {item.label}
            </Link>
          ))}
          {isAdmin ? (
            <Link
              href="/admin/settings"
              className="rounded-full border border-[var(--border-strong)] bg-[var(--accent-soft)] px-3 py-1 text-[13px] font-semibold text-[var(--accent)] transition hover:border-[var(--accent)]/40"
            >
              Admin
            </Link>
          ) : null}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          {email ? (
            <>
              <Link
                href="/billing"
                className="hidden text-[13px] font-semibold text-[var(--accent)] transition hover:underline sm:inline"
              >
                Crédits
              </Link>
              <span className="hidden max-w-[180px] truncate text-xs text-[var(--muted)] sm:inline">
                {email}
              </span>
              <Link
                href="/billing"
                className="inline text-[13px] font-semibold text-[var(--accent)] transition hover:underline sm:hidden"
              >
                Crédits
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link
                href="/auth"
                className="rounded-full px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              >
                Connexion
              </Link>
              <Link href="/auth" className="moboko-btn-primary px-5 py-2 text-sm">
                Commencer
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
