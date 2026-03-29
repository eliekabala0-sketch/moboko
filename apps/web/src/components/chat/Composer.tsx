"use client";

import { useRef, useState } from "react";

type Props = {
  textEnabled: boolean;
  imageEnabled: boolean;
  voiceEnabled: boolean;
  busy: boolean;
  onSendText: (text: string) => Promise<void>;
  onSendImage: (file: File, caption: string) => Promise<void>;
  onSendAudio: (blob: Blob, mime: string, durationMs: number) => Promise<void>;
};

function CapabilityChip({
  label,
  active,
  icon,
}: {
  label: string;
  active: boolean;
  icon: "text" | "image" | "voice";
}) {
  const icons = {
    text: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 6h16M4 12h10M4 18h7"
        />
      </svg>
    ),
    image: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
    voice: (
      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      </svg>
    ),
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
        active
          ? "border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--surface)]/80 text-[var(--muted)] line-through decoration-[var(--muted)]/50"
      }`}
      title={active ? `${label} activé` : `${label} désactivé`}
    >
      {icons[icon]}
      {label}
    </span>
  );
}

export function Composer({
  textEnabled,
  imageEnabled,
  voiceEnabled,
  busy,
  onSendText,
  onSendImage,
  onSendAudio,
}: Props) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedRef = useRef<number>(0);

  async function sendTextLine() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    await onSendText(t);
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || busy) return;
    await onSendImage(f, text.trim());
    setText("");
  }

  async function toggleRecord() {
    if (!voiceEnabled || busy) return;
    if (!recording) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      recRef.current = mr;
      startedRef.current = Date.now();
      mr.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      mr.start();
      setRecording(true);
      return;
    }

    const mr = recRef.current;
    if (!mr) return;
    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
      mr.stop();
      mr.stream.getTracks().forEach((t) => t.stop());
    });
    setRecording(false);
    recRef.current = null;
    const durationMs = Math.max(0, Date.now() - startedRef.current);
    const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
    chunksRef.current = [];
    if (blob.size > 0) {
      await onSendAudio(blob, blob.type || "audio/webm", durationMs);
    }
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--overlay)] px-4 py-4 backdrop-blur-xl">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <CapabilityChip label="Texte" active={textEnabled} icon="text" />
          <CapabilityChip label="Image" active={imageEnabled} icon="image" />
          <CapabilityChip label="Voix" active={voiceEnabled} icon="voice" />
        </div>
        <div className="flex items-end gap-2">
          {imageEnabled ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onPickImage(e)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted)] transition hover:border-[var(--accent)]/35 hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)] disabled:opacity-40"
                aria-label="Ajouter une image"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </button>
            </>
          ) : null}

          {voiceEnabled ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleRecord()}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40 ${
                recording
                  ? "border-[var(--danger)]/50 bg-[var(--danger-soft)] text-[var(--danger)] shadow-[0_0_20px_-4px_var(--danger)]"
                  : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent)]/35 hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)]"
              }`}
              aria-label={recording ? "Arrêter l’enregistrement" : "Message vocal"}
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </button>
          ) : null}

          <div className="relative min-h-[44px] flex-1 rounded-[22px] border border-[var(--border-strong)] bg-[var(--surface)]/90 px-4 py-2 shadow-inner">
            <textarea
              rows={1}
              disabled={!textEnabled || busy}
              placeholder={
                textEnabled
                  ? "Écrivez votre message…"
                  : "Saisie texte désactivée par l’administrateur"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendTextLine();
                }
              }}
              className="max-h-32 min-h-[28px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] disabled:opacity-45"
            />
          </div>

          <button
            type="button"
            disabled={busy || !text.trim() || !textEnabled}
            onClick={() => void sendTextLine()}
            className="moboko-btn-primary flex h-11 shrink-0 items-center justify-center px-5 disabled:opacity-40"
          >
            {busy ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-t-transparent" />
            ) : (
              "Envoyer"
            )}
          </button>
        </div>
        <p className="text-center text-[11px] leading-relaxed text-[var(--muted)] sm:text-left">
          Traitement côté serveur (OpenAI) — crédits débités selon les paramètres admin.
        </p>
      </div>
    </div>
  );
}
