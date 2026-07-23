"use client";

import type { AudioSearchResult } from "@/lib/audio/search";
import Link from "next/link";

function durationLabel(seconds: number | null) {
  if (!seconds) return "Durée non renseignée";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

export function AudioSearchResults({ results }: { results: AudioSearchResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[var(--foreground)]">Sermons audio trouvés ({results.length})</p>
      {results.map((item) => (
        <article key={item.audio_id} className="moboko-card p-5">
          <p className="font-medium text-[var(--foreground)]">{item.sermon_title_fr}</p>
          {item.sermon_title_original ? (
            <p className="mt-1 text-xs text-[var(--muted)]">Titre original : {item.sermon_title_original}</p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--accent)]">
            {[item.sermon_date ?? item.sermon_year, item.location, durationLabel(item.audio_duration_seconds)].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {item.audio_access_state === "allowed" || item.audio_access_state === "free"
              ? item.audio_is_free ? "Audio gratuit" : "Lecture autorisée"
              : "Audio réservé — l’offre adaptée sera proposée à l’ouverture"}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/audio/${encodeURIComponent(item.audio_id)}`} className="moboko-btn-primary inline-flex px-5 py-2.5 text-sm">
              Écouter
            </Link>
            {item.sermon_slug ? (
              <Link href={`/sermons/${encodeURIComponent(item.sermon_slug)}`} className="inline-flex rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)]">
                Lire le sermon
              </Link>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
