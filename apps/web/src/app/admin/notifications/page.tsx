import { resendNotificationAction } from "@/app/admin/notifications/actions";
import { pushConfigured } from "@/lib/notifications/push";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminNotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const [events, deliveries, subscriptions] = await Promise.all([
    supabase
      ?.from("notification_events")
      .select("id, kind, title, priority, status, scheduled_at, sent_at, created_at, payload")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      ?.from("notification_deliveries")
      .select("status")
      .limit(10000),
    supabase
      ?.from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
  ]);
  const rows = deliveries?.data ?? [];
  const sent = rows.filter((row) => row.status === "sent" || row.status === "opened").length;
  const opened = rows.filter((row) => row.status === "opened").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const skipped = rows.filter((row) => row.status === "skipped").length;

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Admin
      </p>
      <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
        Notifications
      </h1>
      <div className="mt-8 grid gap-3 md:grid-cols-5">
        <Metric label="Abonnes" value={subscriptions?.count ?? 0} />
        <Metric label="Envoyees" value={sent} />
        <Metric label="Ouvertes" value={opened} />
        <Metric label="Echouees" value={failed} />
        <Metric label="Ignorees" value={skipped} />
      </div>
      <p className={`moboko-card mt-4 p-4 text-sm ${pushConfigured() ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
        Push serveur : {pushConfigured() ? "configure" : "VAPID non configure"}
      </p>
      <section className="moboko-card mt-6 p-5">
        <h2 className="font-semibold text-[var(--foreground)]">Historique</h2>
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {(events?.data ?? []).map((event) => (
            <li key={event.id} className="py-4">
              <p className="font-medium text-[var(--foreground)]">{event.title}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {event.kind} - {event.priority} - {event.status}
                {event.sent_at ? ` - ${event.sent_at}` : ""}
              </p>
              <form action={resendNotificationAction} className="mt-3">
                <input type="hidden" name="id" value={event.id} />
                <button className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold">
                  Renvoyer
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="moboko-card p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</p>
    </div>
  );
}
