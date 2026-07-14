"use client";

import {
  publishAppearanceAction,
  restoreAppearanceRevisionAction,
  saveAppearanceDraftAction,
  uploadAppearanceAssetAction,
} from "@/app/admin/appearance/actions";
import {
  defaultAppearancePayload,
  type AppearancePayload,
  type AppearanceRevision,
} from "@/lib/appearance/config";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type CSSProperties } from "react";

type Props = {
  draft: AppearanceRevision | null;
  published: AppearanceRevision | null;
  history: AppearanceRevision[];
};

type ImageSlot =
  | ["brand", "logoUrl", "logo"]
  | ["brand", "faviconUrl", "favicon"]
  | ["images", "heroImageUrl", "hero"]
  | ["images", "backgroundImageUrl", "background"];

const imageSlots: Array<{ label: string; value: (payload: AppearancePayload) => string | null; slot: ImageSlot }> = [
  { label: "Logo", value: (payload) => payload.brand.logoUrl, slot: ["brand", "logoUrl", "logo"] },
  { label: "Favicon", value: (payload) => payload.brand.faviconUrl, slot: ["brand", "faviconUrl", "favicon"] },
  { label: "Image principale", value: (payload) => payload.images.heroImageUrl, slot: ["images", "heroImageUrl", "hero"] },
  { label: "Arriere-plan", value: (payload) => payload.images.backgroundImageUrl, slot: ["images", "backgroundImageUrl", "background"] },
];

const positions = [
  { label: "Centre", value: "center center", x: 50, y: 50 },
  { label: "Haut", value: "center top", x: 50, y: 15 },
  { label: "Bas", value: "center bottom", x: 50, y: 85 },
  { label: "Gauche", value: "left center", x: 20, y: 50 },
  { label: "Droite", value: "right center", x: 80, y: 50 },
];

function clonePayload(payload: AppearancePayload) {
  return JSON.parse(JSON.stringify(payload)) as AppearancePayload;
}

function setNested<T extends keyof AppearancePayload, K extends keyof AppearancePayload[T]>(
  payload: AppearancePayload,
  section: T,
  key: K,
  value: AppearancePayload[T][K],
) {
  return {
    ...payload,
    [section]: {
      ...payload[section],
      [key]: value,
    },
  };
}

function titleParts(title: string, highlight: string) {
  if (!highlight.trim()) return [title, "", ""] as const;
  const index = title.toLowerCase().indexOf(highlight.toLowerCase());
  if (index < 0) return [title, "", ""] as const;
  return [title.slice(0, index), title.slice(index, index + highlight.length), title.slice(index + highlight.length)] as const;
}

function imageFocus(payload: AppearancePayload) {
  return `${payload.images.focalX}% ${payload.images.focalY}%`;
}

function Preview({ payload, mode }: { payload: AppearancePayload; mode: "desktop" | "mobile" }) {
  const [before, highlight, after] = titleParts(payload.pages.home.title, payload.pages.home.highlight);
  const blocks = [...payload.blocks].filter((b) => b.enabled).sort((a, b) => a.order - b.order);
  const previewStyle = {
    "--accent": payload.colors.accent,
    "--primary": payload.colors.primary,
  } as CSSProperties;

  return (
    <div
      className={`overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] ${
        mode === "mobile" ? "mx-auto max-w-[320px]" : "w-full"
      }`}
      style={previewStyle}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {payload.brand.logoUrl ? (
            <Image src={payload.brand.logoUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-md object-cover" />
          ) : null}
          <span className="truncate font-display text-sm font-semibold text-[var(--foreground)]">{payload.brand.siteName}</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{mode}</span>
      </div>
      <div
        className={`relative grid gap-6 p-5 ${mode === "desktop" ? "md:grid-cols-[1fr_1.25fr]" : ""}`}
        style={
          payload.images.backgroundImageUrl
            ? {
                backgroundImage: `linear-gradient(rgba(8, 11, 18, 0.82), rgba(8, 11, 18, 0.9)), url(${payload.images.backgroundImageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: imageFocus(payload),
              }
            : undefined
        }
      >
        {blocks.map((block) =>
          block.id === "intro" ? (
            <div key={block.id} className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                {payload.pages.home.eyebrow}
              </p>
              <h3 className="font-display text-2xl font-semibold leading-tight text-[var(--foreground)]">
                {before}
                {highlight ? <span className="text-[var(--accent)]">{highlight}</span> : null}
                {after}
              </h3>
              <p className="text-sm leading-6 text-[var(--muted)]">{payload.pages.home.lead}</p>
              <div className="flex flex-wrap gap-2 pt-1 text-xs font-semibold">
                <span className="rounded-full bg-[var(--primary)] px-4 py-2 text-white">
                  {payload.pages.home.primaryButton}
                </span>
                <span className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-[var(--foreground)]">
                  {payload.pages.home.secondaryButton}
                </span>
              </div>
            </div>
          ) : (
            <div
              key={block.id}
              className="relative aspect-[21/9] min-h-[150px] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)]"
            >
              {payload.images.heroImageUrl ? (
                <Image
                  src={payload.images.heroImageUrl}
                  alt=""
                  fill
                  className="object-cover"
                  style={{ objectPosition: imageFocus(payload), transform: `scale(${payload.images.zoom})` }}
                  sizes="(max-width: 768px) 320px, 640px"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#1a2744] via-[#12192b] to-[#0c1528]" />
              )}
              <div className="absolute inset-0 bg-[var(--background)]" style={{ opacity: payload.images.overlayOpacity }} />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                  {payload.pages.home.heroKicker}
                </p>
                <p className="font-display mt-2 text-lg font-semibold leading-snug text-[var(--foreground)]">
                  {payload.pages.home.heroTitle}
                </p>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function AppearanceStudio({ draft, published, history }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadSlot, setUploadSlot] = useState<ImageSlot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<AppearancePayload>(
    clonePayload(draft?.payload ?? published?.payload ?? defaultAppearancePayload),
  );

  function update<T extends keyof AppearancePayload, K extends keyof AppearancePayload[T]>(
    section: T,
    key: K,
    value: AppearancePayload[T][K],
  ) {
    setPayload((current) => setNested(current, section, key, value));
  }

  function updateImageSlot(slot: ImageSlot, value: string | null) {
    const [section, key] = slot;
    setPayload((current) => {
      if (section === "brand") {
        return setNested(current, "brand", key, value);
      }
      return setNested(current, "images", key, value);
    });
  }

  function updateHome(key: keyof AppearancePayload["pages"]["home"], value: string) {
    setPayload((current) => ({
      ...current,
      pages: { ...current.pages, home: { ...current.pages.home, [key]: value } },
    }));
  }

  function updateDownload(key: keyof AppearancePayload["pages"]["download"], value: string) {
    setPayload((current) => ({
      ...current,
      pages: { ...current.pages, download: { ...current.pages.download, [key]: value } },
    }));
  }

  function saveDraft() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await saveAppearanceDraftAction(payload);
        setMessage("Brouillon enregistre.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Enregistrement impossible");
      }
    });
  }

  function publish() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await publishAppearanceAction(payload);
        setMessage("Apparence publiee.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Publication impossible");
      }
    });
  }

  function restore(id: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await restoreAppearanceRevisionAction(id);
        setMessage("Version restauree en brouillon.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Restauration impossible");
      }
    });
  }

  function chooseFile(slot: ImageSlot) {
    setUploadSlot(slot);
    fileRef.current?.click();
  }

  return (
    <div className="space-y-8">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          if (!file || !uploadSlot) return;
          const fd = new FormData();
          fd.set("file", file);
          fd.set("slot", uploadSlot[2]);
          startTransition(async () => {
            try {
              const url = await uploadAppearanceAssetAction(fd);
              updateImageSlot(uploadSlot, url);
              setMessage("Image chargee. Enregistrez le brouillon ou publiez.");
              setError(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Envoi impossible");
            } finally {
              if (fileRef.current) fileRef.current.value = "";
            }
          });
        }}
      />

      <section className="moboko-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
              Apparence
            </p>
            <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
              Administration visuelle
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              Modifiez l&apos;identite, les images, les textes et l&apos;ordre des blocs sans ouvrir le code.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={saveDraft} disabled={pending} className="rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50">
              Brouillon
            </button>
            <button type="button" onClick={publish} disabled={pending} className="moboko-btn-primary px-5 py-2.5 text-sm disabled:opacity-50">
              Publier
            </button>
          </div>
        </div>
        {message ? <p className="mt-5 rounded-xl border border-[var(--success)]/30 bg-[var(--success-soft)] p-3 text-sm text-[var(--success)]">{message}</p> : null}
        {error ? <p className="mt-5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">{error}</p> : null}
      </section>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <section className="moboko-card space-y-8 p-6 sm:p-8">
          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">Identite et images</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Nom affiche</span>
                <input value={payload.brand.siteName} onChange={(e) => update("brand", "siteName", e.target.value)} className="moboko-input mt-2" />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Position rapide</span>
                <select
                  value={payload.images.objectPosition}
                  onChange={(e) => {
                    const position = positions.find((item) => item.value === e.target.value) ?? positions[0]!;
                    setPayload((current) => ({
                      ...current,
                      images: {
                        ...current.images,
                        objectPosition: position.value,
                        focalX: position.x,
                        focalY: position.y,
                      },
                    }));
                  }}
                  className="moboko-input mt-2"
                >
                  {positions.map((position) => (
                    <option key={position.value} value={position.value}>
                      {position.label}
                    </option>
                  ))}
                </select>
              </label>
              {imageSlots.map(({ label, value, slot }) => (
                <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/50 p-4">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{label}</p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">{value(payload) || "Aucun fichier"}</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => chooseFile(slot)} className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-xs font-semibold text-[var(--foreground)]">
                      Choisir
                    </button>
                    <button
                      type="button"
                      onClick={() => updateImageSlot(slot, null)}
                      className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--danger)]"
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              ))}
              <label className="text-sm font-medium text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Point focal X: {payload.images.focalX}%</span>
                <input type="range" min={0} max={100} value={payload.images.focalX} onChange={(e) => update("images", "focalX", Number(e.target.value))} className="mt-3 w-full" />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Point focal Y: {payload.images.focalY}%</span>
                <input type="range" min={0} max={100} value={payload.images.focalY} onChange={(e) => update("images", "focalY", Number(e.target.value))} className="mt-3 w-full" />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Zoom: {payload.images.zoom.toFixed(2)}</span>
                <input type="range" min={1} max={2.5} step={0.05} value={payload.images.zoom} onChange={(e) => update("images", "zoom", Number(e.target.value))} className="mt-3 w-full" />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Opacite overlay: {Math.round(payload.images.overlayOpacity * 100)}%</span>
                <input type="range" min={0} max={0.9} step={0.05} value={payload.images.overlayOpacity} onChange={(e) => update("images", "overlayOpacity", Number(e.target.value))} className="mt-3 w-full" />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Couleur accent</span>
                <input type="color" value={payload.colors.accent} onChange={(e) => update("colors", "accent", e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-transparent" />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Couleur action</span>
                <input type="color" value={payload.colors.primary} onChange={(e) => update("colors", "primary", e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-transparent" />
              </label>
            </div>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">Textes accueil</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["Eyebrow accueil", "eyebrow"],
                ["Titre accueil", "title"],
                ["Texte en couleur", "highlight"],
                ["Bouton principal", "primaryButton"],
                ["Lien principal", "primaryHref"],
                ["Bouton secondaire", "secondaryButton"],
                ["Lien secondaire", "secondaryHref"],
                ["Kicker image", "heroKicker"],
                ["Titre image", "heroTitle"],
              ].map(([label, key]) => (
                <label key={key} className="text-sm font-medium text-[var(--foreground)]">
                  <span className="text-[var(--muted)]">{label}</span>
                  <input
                    value={String(payload.pages.home[key as keyof AppearancePayload["pages"]["home"]])}
                    onChange={(e) => updateHome(key as keyof AppearancePayload["pages"]["home"], e.target.value)}
                    className="moboko-input mt-2"
                  />
                </label>
              ))}
              <label className="text-sm font-medium text-[var(--foreground)] sm:col-span-2">
                <span className="text-[var(--muted)]">Texte d&apos;accueil</span>
                <textarea
                  value={payload.pages.home.lead}
                  onChange={(e) => updateHome("lead", e.target.value)}
                  className="moboko-input mt-2 min-h-28"
                />
              </label>
            </div>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">Textes telechargement</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["Titre", "title"],
                ["Bouton installer", "primaryButton"],
                ["Bouton secondaire", "secondaryButton"],
              ].map(([label, key]) => (
                <label key={key} className="text-sm font-medium text-[var(--foreground)]">
                  <span className="text-[var(--muted)]">{label}</span>
                  <input
                    value={String(payload.pages.download[key as keyof AppearancePayload["pages"]["download"]])}
                    onChange={(e) => updateDownload(key as keyof AppearancePayload["pages"]["download"], e.target.value)}
                    className="moboko-input mt-2"
                  />
                </label>
              ))}
              <label className="text-sm font-medium text-[var(--foreground)] sm:col-span-2">
                <span className="text-[var(--muted)]">Texte de presentation</span>
                <textarea
                  value={payload.pages.download.lead}
                  onChange={(e) => updateDownload("lead", e.target.value)}
                  className="moboko-input mt-2 min-h-24"
                />
              </label>
            </div>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">Blocs</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {payload.blocks.map((block) => (
                <div key={block.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/50 p-4">
                  <label className="flex items-center gap-3 text-sm font-semibold text-[var(--foreground)]">
                    <input
                      type="checkbox"
                      checked={block.enabled}
                      onChange={(e) =>
                        setPayload((current) => ({
                          ...current,
                          blocks: current.blocks.map((b) => (b.id === block.id ? { ...b, enabled: e.target.checked } : b)),
                        }))
                      }
                    />
                    {block.label}
                  </label>
                  <label className="mt-3 block text-xs text-[var(--muted)]">
                    Ordre
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={block.order}
                      onChange={(e) =>
                        setPayload((current) => ({
                          ...current,
                          blocks: current.blocks.map((b) => (b.id === block.id ? { ...b, order: Number(e.target.value) } : b)),
                        }))
                      }
                      className="moboko-input mt-2"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="moboko-card p-5">
            <h2 className="font-display text-lg font-semibold text-[var(--foreground)]">Apercu desktop</h2>
            <div className="mt-4">
              <Preview payload={payload} mode="desktop" />
            </div>
          </section>
          <section className="moboko-card p-5">
            <h2 className="font-display text-lg font-semibold text-[var(--foreground)]">Apercu mobile</h2>
            <div className="mt-4">
              <Preview payload={payload} mode="mobile" />
            </div>
          </section>
          <section className="moboko-card p-5">
            <h2 className="font-display text-lg font-semibold text-[var(--foreground)]">Restaurer</h2>
            <div className="mt-4 space-y-2">
              {history.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Aucune version enregistree.</p>
              ) : (
                history.map((revision) => (
                  <div key={revision.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">{revision.title}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {revision.status} - {new Date(revision.updated_at).toLocaleString("fr-FR")}
                      </p>
                    </div>
                    <button type="button" onClick={() => restore(revision.id)} className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)]">
                      Restaurer
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
