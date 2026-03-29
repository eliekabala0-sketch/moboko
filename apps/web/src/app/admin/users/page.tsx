import { UserBillingRow } from "@/components/admin/UserBillingRow";
import { fetchUsersForAdmin, type AdminUserRow } from "@/lib/admin/users-data";

export default async function AdminUsersPage() {
  let users: AdminUserRow[] = [];
  let loadError: string | null = null;
  try {
    users = await fetchUsersForAdmin();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Chargement impossible";
    users = [];
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Facturation
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
          Utilisateurs & crédits
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          Solde crédits, premium et accès offert (paiement Badiboss Pay à brancher plus tard).
        </p>
      </div>

      {loadError ? (
        <div
          className="rounded-2xl border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-5 py-4 text-sm text-[var(--foreground)]"
          role="alert"
        >
          <span className="font-medium text-[var(--warning)]">Attention — </span>
          {loadError}
        </div>
      ) : null}

      <div className="moboko-card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                <th className="px-5 py-3.5">Utilisateur</th>
                <th className="px-5 py-3.5">Crédits</th>
                <th className="px-5 py-3.5">Premium</th>
                <th className="px-5 py-3.5">Gratuit</th>
                <th className="px-5 py-3.5"> </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserBillingRow key={u.id} row={u} />
              ))}
            </tbody>
          </table>
        </div>
        {users.length === 0 && !loadError ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface)]/60">
              <svg
                className="h-6 w-6 text-[var(--muted)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--foreground)]">Aucun utilisateur</p>
            <p className="mt-1 max-w-xs text-xs text-[var(--muted)]">
              Les comptes apparaîtront ici une fois inscrits.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
