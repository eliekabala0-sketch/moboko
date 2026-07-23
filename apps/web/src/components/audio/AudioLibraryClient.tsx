"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type AudioItem = {
  id: string;
  category: "sermon" | "prayer_line";
  title: string;
  title_original?: string | null;
  sermon_title_fr?: string | null;
  original_filename: string;
  file_size: number | null;
  duration_seconds: number | null;
  sermon_date: string | null;
  sermon_year: number | null;
  location: string | null;
  streaming_enabled: boolean;
  offline_enabled: boolean;
  full_download_enabled: boolean;
  sermons?: { slug?: string | null; title?: string | null } | { slug?: string | null; title?: string | null }[] | null;
};

type Access = {
  audio_streaming: boolean;
  audio_offline_in_app: boolean;
  audio_full_download: boolean;
};

type ApiResponse = {
  ok: true;
  results: AudioItem[];
  count: number;
  page: number;
  limit: number;
  access: Access;
};

function sizeLabel(bytes: number | null) {
  if (!bytes) return "Taille inconnue";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function durationLabel(seconds: number | null) {
  if (!seconds) return "Duree a verifier";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
}

function sermonSlug(item: AudioItem) {
  const sermon = Array.isArray(item.sermons) ? item.sermons[0] : item.sermons;
  return sermon?.slug ?? null;
}

function sermonTitle(item: AudioItem) {
  const sermon = Array.isArray(item.sermons) ? item.sermons[0] : item.sermons;
  return item.sermon_title_fr || sermon?.title || item.title;
}

export function AudioLibraryClient({ category, focusId }: { category?: "sermon" | "prayer_line"; focusId?: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AudioItem[]>([]);
  const [count, setCount] = useState(0);
  const [access, setAccess] = useState<Access>({ audio_streaming: false, audio_offline_in_app: false, audio_full_download: false });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const limit = 20;

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit), sort });
    if (category) p.set("category", category);
    if (q.trim()) p.set("q", q.trim());
    return p;
  }, [category, limit, page, q, sort]);

  useEffect(() => {
    let cancelled = false;
    fetch(focusId ? `/api/audio/${encodeURIComponent(focusId)}` : `/api/audio?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json() as Promise<ApiResponse & { audio?: AudioItem }>)
      .then((data) => {
        if (cancelled) return;
        const nextItems = focusId && data.audio ? [data.audio] : data.results ?? [];
        setItems(nextItems);
        setCount(focusId ? nextItems.length : data.count ?? 0);
        if (data.access) setAccess(data.access);
      })
      .catch(() => {
        if (!cancelled) setMessage("La mediatheque audio est momentanement indisponible.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focusId, params]);

  async function signedAction(id: string, action: "stream" | "offline" | "download") {
    setMessage(null);
    const res = await fetch(`/api/audio/${id}/${action}`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string; error?: string; filename?: string };
    if (!res.ok || !data.url) throw new Error(data.message ?? data.error ?? "Action audio indisponible");
    return data;
  }

  async function play(item: AudioItem) {
    try {
      const data = await signedAction(item.id, "stream");
      setPlayingId(item.id);
      setAudioUrl(data.url ?? null);
      setTimeout(() => void audioRef.current?.play().catch(() => undefined), 50);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Lecture impossible");
    }
  }

  async function prepareOffline(item: AudioItem) {
    try {
      const data = await signedAction(item.id, "offline");
      setMessage(`Lien hors connexion prepare. Taille: ${sizeLabel(item.file_size)}.`);
      setPlayingId(item.id);
      setAudioUrl(data.url ?? null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Hors connexion indisponible");
    }
  }

  async function downloadFile(item: AudioItem) {
    try {
      const data = await signedAction(item.id, "download");
      window.location.href = data.url ?? "";
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Telechargement indisponible");
    }
  }

  const totalPages = Math.max(1, Math.ceil(count / limit));

  return (
    <div className="mt-8">
      {!focusId ? <div className="moboko-card grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
            setBusy(true);
          }}
          className="moboko-input"
          type="search"
          placeholder="Titre, annee, lieu, nom du fichier..."
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
            setBusy(true);
          }}
          className="moboko-input"
        >
          <option value="recent">Plus recent</option>
          <option value="oldest">Plus ancien</option>
          <option value="az">A vers Z</option>
          <option value="za">Z vers A</option>
        </select>
      </div> : null}

      {message ? <p className="moboko-card mt-4 p-4 text-sm text-[var(--muted)]">{message}</p> : null}

      {audioUrl ? (
        <div className="moboko-card sticky top-20 z-20 mt-4 p-4">
          <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">
            Lecture en cours
          </p>
          <audio ref={audioRef} src={audioUrl} controls className="w-full" preload="metadata" />
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {busy ? <p className="text-sm text-[var(--muted)]">Chargement...</p> : null}
        {!busy && items.length === 0 ? (
          <p className="moboko-card p-6 text-sm text-[var(--muted)]">Aucun audio trouve.</p>
        ) : null}
        {items.map((item) => {
          const slug = sermonSlug(item);
          return (
            <article key={item.id} className="moboko-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                    {item.category === "sermon" ? "Sermon audio" : "Ligne de priere"}
                  </p>
                  <Link href={`/audio/${item.id}`} className="mt-2 block font-medium text-[var(--foreground)] hover:text-[var(--accent)]">
                    {sermonTitle(item)}
                  </Link>
                  {(item.title_original || item.title) !== sermonTitle(item) ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">Titre original : {item.title_original || item.title}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {[item.sermon_date ?? item.sermon_year, item.location, durationLabel(item.duration_seconds), sizeLabel(item.file_size)].filter(Boolean).join(" - ")}
                  </p>
                </div>
                {playingId === item.id ? <span className="text-xs font-semibold text-[var(--accent)]">En ecoute</span> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                <button className="moboko-btn-primary px-4 py-2" onClick={() => void play(item)} disabled={!item.streaming_enabled}>
                  Ecouter
                </button>
                <button
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-[var(--muted)] disabled:opacity-40"
                  onClick={() => void prepareOffline(item)}
                  disabled={!access.audio_offline_in_app || !item.offline_enabled}
                >
                  Hors connexion
                </button>
                <button
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-[var(--muted)] disabled:opacity-40"
                  onClick={() => void downloadFile(item)}
                  disabled={!access.audio_full_download || !item.full_download_enabled}
                >
                  Telecharger le fichier
                </button>
                {slug ? (
                  <Link href={`/sermons/${encodeURIComponent(slug)}`} className="rounded-full border border-[var(--border)] px-4 py-2 text-[var(--muted)] hover:text-[var(--foreground)]">
                    Lire le sermon
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {!focusId ? <div className="mt-6 flex items-center justify-between text-sm text-[var(--muted)]">
        <button className="rounded-full border border-[var(--border)] px-4 py-2 disabled:opacity-40" disabled={page <= 1} onClick={() => { setBusy(true); setPage((p) => Math.max(1, p - 1)); }}>
          Precedent
        </button>
        <span>
          Page {page} / {totalPages}
        </span>
        <button className="rounded-full border border-[var(--border)] px-4 py-2 disabled:opacity-40" disabled={page >= totalPages} onClick={() => { setBusy(true); setPage((p) => Math.min(totalPages, p + 1)); }}>
          Suivant
        </button>
      </div> : null}
    </div>
  );
}
