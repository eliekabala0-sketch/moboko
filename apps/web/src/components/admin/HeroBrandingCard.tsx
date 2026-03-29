"use client";

import {
  clearBrandingHeroAction,
  uploadBrandingHeroAction,
} from "@/app/admin/settings/actions";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type Props = {
  currentPublicUrl: string | null;
};

export function HeroBrandingCard({ currentPublicUrl }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const displayUrl = preview || currentPublicUrl;

  function onFileChange(f: File | null) {
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    if (!f) {
      setPreview(null);
      setPickedFile(false);
      return;
    }
    setPickedFile(true);
    setPreview(URL.createObjectURL(f));
  }

  return (
    <section className="moboko-card p-6 sm:p-8">
      <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">
        Image d’accueil (bucket branding)
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        Fichier public remplacé à chaque envoi ; l’URL est enregistrée dans{" "}
        <code className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]/90">
          home_hero_image_url
        </code>
        .
      </p>

      <div className="mt-8 flex flex-col gap-8 sm:flex-row">
        <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-inner">
          {displayUrl ? (
            <Image
              src={displayUrl}
              alt="Aperçu bannière"
              fill
              className="object-cover"
              sizes="(max-width: 448px) 100vw, 448px"
              unoptimized={displayUrl.startsWith("blob:")}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/50">
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
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <p className="text-sm text-[var(--muted)]">Aucune image — dégradé sur le site</p>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)]/35 disabled:opacity-50"
          >
            Choisir une image
          </button>
          <button
            type="button"
            disabled={pending || !pickedFile}
            onClick={() => {
              const file = inputRef.current?.files?.[0];
              if (!file) return;
              setError(null);
              const fd = new FormData();
              fd.set("hero", file);
              startTransition(async () => {
                try {
                  await uploadBrandingHeroAction(fd);
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(null);
                  setPickedFile(false);
                  if (inputRef.current) inputRef.current.value = "";
                  router.refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Échec de l’envoi");
                }
              });
            }}
            className="moboko-btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
          >
            {pending ? "Envoi…" : "Enregistrer sur Supabase"}
          </button>
          <button
            type="button"
            disabled={pending || (!currentPublicUrl && !preview)}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  await clearBrandingHeroAction();
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(null);
                  setPickedFile(false);
                  if (inputRef.current) inputRef.current.value = "";
                  router.refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Échec");
                }
              });
            }}
            className="text-left text-sm font-medium text-[var(--danger)] transition hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Retirer l’image du site
          </button>
          {error ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
