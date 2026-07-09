import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminEngagementPage() {
  const supabase = await createSupabaseServerClient();
  const [requests, testimonies, support] = await Promise.all([
    supabase
      ?.from("prayer_requests")
      .select("id, name, email, request_text, status, created_at")
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
        Requêtes, témoignages et soutien
      </h1>
      <div className="mt-8 grid gap-6">
        <AdminList
          title="Requêtes de prière"
          rows={(requests?.data ?? []).map((r) => ({
            id: r.id,
            title: r.name || r.email || "Anonyme",
            status: r.status,
            body: r.request_text,
          }))}
        />
        <AdminList
          title="Témoignages"
          rows={(testimonies?.data ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            body: r.testimony_text,
          }))}
        />
        <AdminList
          title="Soutien"
          rows={(support?.data ?? []).map((r) => ({
            id: r.id,
            title: r.subject || r.name || r.email || "Message",
            status: r.status,
            body: r.message,
          }))}
        />
      </div>
    </div>
  );
}

function AdminList({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; title: string; status: string; body: string }[];
}) {
  return (
    <section className="moboko-card p-5">
      <h2 className="font-semibold text-[var(--foreground)]">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">Aucun élément.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-[var(--border)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-[var(--foreground)]">{row.title}</p>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                  {row.status}
                </span>
              </div>
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                {row.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
