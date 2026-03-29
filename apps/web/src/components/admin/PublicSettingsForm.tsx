"use client";

import { savePublicAppSettingsAction } from "@/app/admin/settings/actions";
import { PUBLIC_APP_SETTING_KEYS, type JsonScalar } from "@moboko/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  initial: Record<string, JsonScalar>;
};

export function PublicSettingsForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState(
    String(initial[PUBLIC_APP_SETTING_KEYS.homeHeroTitle] ?? ""),
  );
  const [subtitle, setSubtitle] = useState(
    String(initial[PUBLIC_APP_SETTING_KEYS.homeHeroSubtitle] ?? ""),
  );
  const [chatText, setChatText] = useState(
    Boolean(initial[PUBLIC_APP_SETTING_KEYS.chatTextEnabled]),
  );
  const [chatVoice, setChatVoice] = useState(
    Boolean(initial[PUBLIC_APP_SETTING_KEYS.chatVoiceEnabled]),
  );
  const [chatImage, setChatImage] = useState(
    Boolean(initial[PUBLIC_APP_SETTING_KEYS.chatImageEnabled]),
  );
  const [costText, setCostText] = useState(
    Number(initial[PUBLIC_APP_SETTING_KEYS.textCreditCost] ?? 1),
  );
  const [costVoice, setCostVoice] = useState(
    Number(initial[PUBLIC_APP_SETTING_KEYS.voiceCreditCost] ?? 2),
  );
  const [costImage, setCostImage] = useState(
    Number(initial[PUBLIC_APP_SETTING_KEYS.imageCreditCost] ?? 3),
  );
  const [initialCredits, setInitialCredits] = useState(
    Number(initial[PUBLIC_APP_SETTING_KEYS.initialFreeCredits] ?? 5),
  );

  function save() {
    setErr(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await savePublicAppSettingsAction({
          [PUBLIC_APP_SETTING_KEYS.homeHeroTitle]: title,
          [PUBLIC_APP_SETTING_KEYS.homeHeroSubtitle]: subtitle,
          [PUBLIC_APP_SETTING_KEYS.chatTextEnabled]: chatText,
          [PUBLIC_APP_SETTING_KEYS.chatVoiceEnabled]: chatVoice,
          [PUBLIC_APP_SETTING_KEYS.chatImageEnabled]: chatImage,
          [PUBLIC_APP_SETTING_KEYS.textCreditCost]: Math.max(0, Math.floor(costText)),
          [PUBLIC_APP_SETTING_KEYS.voiceCreditCost]: Math.max(0, Math.floor(costVoice)),
          [PUBLIC_APP_SETTING_KEYS.imageCreditCost]: Math.max(0, Math.floor(costImage)),
          [PUBLIC_APP_SETTING_KEYS.initialFreeCredits]: Math.max(0, Math.floor(initialCredits)),
        });
        setMessage("Paramètres enregistrés.");
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  return (
    <section className="moboko-card p-6 sm:p-8">
      <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">Textes & chat</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        Titres d’accueil, activation des entrées du chat et coûts en crédits (affichage / logique future).
      </p>

      <div className="mt-8 space-y-6">
        <label className="block text-sm font-medium text-[var(--foreground)]">
          <span className="text-[var(--muted)]">Titre hero</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="moboko-input mt-2"
          />
        </label>
        <label className="block text-sm font-medium text-[var(--foreground)]">
          <span className="text-[var(--muted)]">Sous-titre hero</span>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            className="moboko-input mt-2"
          />
        </label>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Modes du chat
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["Texte", chatText, setChatText] as const,
                ["Voix", chatVoice, setChatVoice] as const,
                ["Image", chatImage, setChatImage] as const,
              ] as const
            ).map(([label, val, set]) => (
              <label
                key={label}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]/50 px-4 py-3 transition hover:border-[var(--border-strong)]"
              >
                <input
                  type="checkbox"
                  checked={val}
                  onChange={(e) => set(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--primary)]"
                />
                <span className="text-sm text-[var(--foreground)]">Chat {label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Crédits
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-medium text-[var(--foreground)]">
              <span className="text-[var(--muted)]">À l&apos;inscription</span>
              <input
                type="number"
                min={0}
                value={initialCredits}
                onChange={(e) => setInitialCredits(Number(e.target.value))}
                className="moboko-input mt-2 tabular-nums"
              />
              <span className="mt-1.5 block text-[11px] font-normal leading-relaxed text-[var(--muted)]">
                Nouveaux comptes uniquement (trigger profil).
              </span>
            </label>
            <label className="text-sm font-medium text-[var(--foreground)]">
              <span className="text-[var(--muted)]">Coût texte</span>
              <input
                type="number"
                min={0}
                value={costText}
                onChange={(e) => setCostText(Number(e.target.value))}
                className="moboko-input mt-2 tabular-nums"
              />
            </label>
            <label className="text-sm font-medium text-[var(--foreground)]">
              <span className="text-[var(--muted)]">Coût voix</span>
              <input
                type="number"
                min={0}
                value={costVoice}
                onChange={(e) => setCostVoice(Number(e.target.value))}
                className="moboko-input mt-2 tabular-nums"
              />
            </label>
            <label className="text-sm font-medium text-[var(--foreground)]">
              <span className="text-[var(--muted)]">Coût image</span>
              <input
                type="number"
                min={0}
                value={costImage}
                onChange={(e) => setCostImage(Number(e.target.value))}
                className="moboko-input mt-2 tabular-nums"
              />
            </label>
          </div>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={() => save()}
          className="moboko-btn-primary px-8 py-3 disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {message ? (
          <p className="rounded-xl border border-[var(--success)]/30 bg-[var(--success-soft)] px-4 py-3 text-sm text-[var(--success)]" role="status">
            {message}
          </p>
        ) : null}
        {err ? (
          <p className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </section>
  );
}
