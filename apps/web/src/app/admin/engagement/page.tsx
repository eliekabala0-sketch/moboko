import {
  archivePrayerRequestAction,
  archiveSupportMessageAction,
  archiveTestimonyAction,
  createPrayerRequestAction,
  createTestimonyAction,
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
          <h2 className="font-semibold text-[var(--foreground)]">Creer une requete</h2>
          <form action={createPrayerRequestAction} className="mt-4 grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input name="name" className="moboko-input" placeholder="Nom affiche" />
              <input name="email" type="email" className="moboko-input" placeholder="Email optionnel" />
            </div>
            <textarea name="request_text" required minLength={3} className="moboko-input min-h-28 resize-y" placeholder="Requete" />
            <div className="flex flex-wrap gap-4 text-sm text-[var(--muted)]">
              <label className="flex items-center gap-2"><input name="anonymous" type="checkbox" /> Anonyme</label>
              <label className="flex items-center gap-2"><input name="is_public" type="checkbox" /> Publique</label>
              <label className="flex items-center gap-2"><input name="publish" type="checkbox" /> Valider maintenant</label>
            </div>
            <button className="moboko-btn-primary w-fit px-5 py-2 text-sm">Creer</button>
          </form>
        </section>

        <section className="moboko-card p-5">
          <h2 className="font-semibold text-[var(--foreground)]">Publier un temoignage</h2>
          <form action={createTestimonyAction} className="mt-4 grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input name="name" className="moboko-input" placeholder="Nom affiche" />
              <input name="title" required minLength={2} className="moboko-input" placeholder="Titre" />
            </div>
            <textarea name="testimony_text" required minLength={3} className="moboko-input min-h-28 resize-y" placeholder="Temoignage" />
            <div className="flex flex-wrap gap-4 text-sm text-[var(--muted)]">
              <label className="flex items-center gap-2"><input name="anonymous" type="checkbox" /> Anonyme</label>
              <label className="flex items-center gap-2"><input name="publish" type="checkbox" /> Publier maintenant</label>
            </div>
            <button className="moboko-btn-primary w-fit px-5 py-2 text-sm">Creer</button>
          </form>
        </section>

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
