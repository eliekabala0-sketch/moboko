import { Masthead } from "@/components/layout/Masthead";
import { NotificationSettingsClient } from "@/components/notifications/NotificationSettingsClient";

export const metadata = { title: "Notifications | Moboko" };

export default function NotificationsPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Paramètres
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
          Notifications
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Choisissez les alertes que Moboko peut envoyer sur cet appareil.
        </p>
        <NotificationSettingsClient />
      </main>
    </div>
  );
}
