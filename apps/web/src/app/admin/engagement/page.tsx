import {
  archivePrayerRequestAction,
  archiveSupportMessageAction,
  archiveTestimonyAction,
  deletePrayerRequestAction,
  deleteSupportMessageAction,
  deleteTestimonyAction,
  publishTestimonyAction,
  reviewPrayerRequestAction,
  reviewSupportMessageAction,
} from "@/app/admin/engagement/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminEngagementPage() {
  const supabase = await createSupabaseServerClient();
  const [requests, testimonies, support] = await Promise.all([
    supabase
      ?.from("prayer_requests")
      .select("id, name, email, request_text, status, is_public, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      ?.from("testimonies")
      .select("id, name, title, testimony_text, status, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      ?.from("support_messages")
      .select("id, name, email, subject, message, status, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Admin
      </p>
      <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
        Requetes, temoignages et soutien
      </h1>
      <div className="mt-8 grid gap-6">
        <section className="moboko-card p-5">
          <h2 className="font-semibold text-[var(--foreground)]">Requetes de priere</h2>
          <ul className="mt-4 space-y-3">
            {(requests?.data ?? []).map((row) => (
              <li key={row.id} className="rounded-xl border border-[var(--border)] p-4">
                <EngagementHeader title={row.name || row.email || "Anonyme"} status={row.status} />
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                  {row.request_text}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={reviewPrayerRequestAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={row.id} />
                    <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                      <input name="is_public" type="checkbox" defaultChecked={Boolean(row.is_public)} />
                      Alerte publique
                    </label>
                    <button className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold">
                      Valider
                    </button>
                  </form>
                  <form action={archivePrayerRequestAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="rounded-full border border-[var(--danger)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">
                      Rejeter
                    </button>
                  </form>
                  <form action={deletePrayerRequestAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="rounded-full border border-[var(--danger)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">
                      Supprimer
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          {(requests?.data ?? []).length === 0 ? <EmptyLine /> : null}
        </section>

        <section className="moboko-card p-5">
          <h2 className="font-semibold text-[var(--foreground)]">Temoignages</h2>
          <ul className="mt-4 space-y-3">
            {(testimonies?.data ?? []).map((row) => (
              <li key={row.id} className="rounded-xl border border-[var(--border)] p-4">
                <EngagementHeader title={row.title} status={row.status} />
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                  {row.testimony_text}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={publishTestimonyAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold">
                      Publier
                    </button>
                  </form>
                  <form action={archiveTestimonyAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="rounded-full border border-[var(--danger)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">
                      Rejeter
                    </button>
                  </form>
                  <form action={deleteTestimonyAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="rounded-full border border-[var(--danger)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">
                      Supprimer
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          {(testimonies?.data ?? []).length === 0 ? <EmptyLine /> : null}
        </section>

        <section className="moboko-card p-5">
          <h2 className="font-semibold text-[var(--foreground)]">Soutien</h2>
          <ul className="mt-4 space-y-3">
            {(support?.data ?? []).map((row) => (
              <li key={row.id} className="rounded-xl border border-[var(--border)] p-4">
                <EngagementHeader title={row.subject || row.name || row.email || "Message"} status={row.status} />
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                  {row.message}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={reviewSupportMessageAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold">
                      Traite
                    </button>
                  </form>
                  <form action={archiveSupportMessageAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="rounded-full border border-[var(--danger)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">
                      Archiver
                    </button>
                  </form>
                  <form action={deleteSupportMessageAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="rounded-full border border-[var(--danger)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">
                      Supprimer
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          {(support?.data ?? []).length === 0 ? <EmptyLine /> : null}
        </section>
      </div>
    </div>
  );
}

function EngagementHeader({ title, status }: { title: string; status: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium text-[var(--foreground)]">{title}</p>
      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
        {status}
      </span>
    </div>
  );
}

function EmptyLine() {
  return <p className="mt-3 text-sm text-[var(--muted)]">Aucun element.</p>;
}
