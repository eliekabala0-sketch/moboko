"use client";

import { useEffect, useState } from "react";

type Prefs = Record<
  | "all_notifications"
  | "important_announcements"
  | "publications"
  | "prayer_requests"
  | "testimonies"
  | "prayer_replies"
  | "testimony_replies",
  boolean
>;

const LABELS: [keyof Prefs, string][] = [
  ["all_notifications", "Recevoir les notifications"],
  ["important_announcements", "Annonces importantes"],
  ["publications", "Publications"],
  ["prayer_requests", "Requetes de priere"],
  ["testimonies", "Temoignages"],
  ["prayer_replies", "Reponses a mes requetes"],
  ["testimony_replies", "Reponses a mes temoignages"],
];

const DEFAULT_PREFS: Prefs = {
  all_notifications: true,
  important_announcements: true,
  publications: true,
  prayer_requests: true,
  testimonies: true,
  prayer_replies: true,
  testimony_replies: true,
};

function browserPushSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function NotificationSettingsClient() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [message, setMessage] = useState<string | null>(null);
  const [supported] = useState(browserPushSupported);

  useEffect(() => {
    fetch("/api/notifications/preferences", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.preferences) setPrefs({ ...DEFAULT_PREFS, ...data.preferences });
      })
      .catch(() => undefined);
  }, []);

  async function save(next: Prefs) {
    setPrefs(next);
    await fetch("/api/notifications/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  }

  async function enablePush() {
    setMessage(null);
    if (!supported) {
      setMessage("Les notifications Push ne sont pas disponibles sur cet appareil.");
      return;
    }
    const keyRes = await fetch("/api/notifications/vapid-key");
    const keyData = (await keyRes.json()) as { ok?: boolean; publicKey?: string | null };
    if (!keyData.ok || !keyData.publicKey) {
      setMessage("Les notifications Push ne sont pas encore configurees sur le serveur.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMessage("Autorisation refusee par le navigateur.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      }));
    const res = await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });
    setMessage(res.ok ? "Notifications activees sur cet appareil." : "Activation impossible pour le moment.");
  }

  return (
    <div className="mt-8 space-y-4">
      <section className="moboko-card p-5">
        <h2 className="font-semibold text-[var(--foreground)]">Notifications systeme</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Activez les notifications sur cet appareil pour recevoir les annonces et messages importants meme hors de l&apos;application.
        </p>
        <button onClick={() => void enablePush()} className="moboko-btn-primary mt-4 px-5 py-2 text-sm">
          Activer sur cet appareil
        </button>
        {message ? <p className="mt-3 text-sm text-[var(--muted)]">{message}</p> : null}
      </section>

      <section className="moboko-card p-5">
        <h2 className="font-semibold text-[var(--foreground)]">Preferences</h2>
        <div className="mt-4 space-y-3">
          {LABELS.map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] p-3 text-sm">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={Boolean(prefs[key])}
                onChange={(event) => void save({ ...prefs, [key]: event.target.checked })}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
