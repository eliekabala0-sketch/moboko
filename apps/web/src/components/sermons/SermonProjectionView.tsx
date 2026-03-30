"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export type ProjectionParagraph = {
  paragraph_number: number;
  paragraph_text: string;
};

type Props = {
  slug: string;
  sermonTitle: string;
  metaLine: string;
  paragraphs: ProjectionParagraph[];
  initialIndex: number;
};

export function SermonProjectionView({
  slug,
  sermonTitle,
  metaLine,
  paragraphs,
  initialIndex,
}: Props) {
  const safeInitial = useMemo(() => {
    if (paragraphs.length === 0) return 0;
    const i = Math.min(Math.max(0, initialIndex), paragraphs.length - 1);
    return i;
  }, [initialIndex, paragraphs.length]);

  const [index, setIndex] = useState(safeInitial);

  useEffect(() => {
    setIndex(safeInitial);
  }, [safeInitial]);

  const current = paragraphs[index];
  const atStart = index <= 0;
  const atEnd = index >= paragraphs.length - 1;

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(paragraphs.length - 1, i + 1));
  }, [paragraphs.length]);

  const goStart = useCallback(() => {
    setIndex(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("button, a, input, textarea, select, [contenteditable=true]")) {
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Home") {
        e.preventDefault();
        goStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, goStart]);

  const readHref = `/sermons/${encodeURIComponent(slug)}`;
  const projectBase = `/sermons/${encodeURIComponent(slug)}/project`;

  if (paragraphs.length === 0 || !current) {
    return (
      <div className="flex min-h-[70vh] flex-col">
        <header className="border-b border-[var(--border)] bg-[var(--overlay)] px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <Link
              href={readHref}
              className="text-sm font-medium text-[var(--accent)] transition hover:text-[var(--foreground)]"
            >
              ← Lecture
            </Link>
            <span className="truncate text-sm text-[var(--muted)]">{sermonTitle}</span>
          </div>
        </header>
        <p className="mx-auto mt-16 max-w-lg px-6 text-center text-sm text-[var(--muted)]">
          Aucun paragraphe à projeter pour ce sermon.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--overlay)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href={readHref}
              className="shrink-0 text-sm font-medium text-[var(--accent)] transition hover:text-[var(--foreground)]"
            >
              ← Lecture
            </Link>
            <span className="hidden h-4 w-px bg-[var(--border)] sm:block" aria-hidden />
            <h1 className="min-w-0 truncate font-display text-base font-semibold text-[var(--foreground)] sm:max-w-[min(100%,32rem)]">
              {sermonTitle}
            </h1>
          </div>
          {metaLine ? (
            <p className="truncate text-xs text-[var(--muted)] sm:max-w-md sm:text-right">{metaLine}</p>
          ) : null}
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 pb-28 pt-8 sm:px-8 sm:pb-32 sm:pt-12 md:px-12">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
            Paragraphe {current.paragraph_number}
            <span className="text-[var(--muted)]">
              {" "}
              · {index + 1} / {paragraphs.length}
            </span>
          </p>
          <div
            className="moboko-card mt-6 flex flex-1 flex-col justify-center px-5 py-8 sm:px-10 sm:py-12 md:px-14 md:py-16"
            role="article"
            aria-live="polite"
            aria-atomic="true"
          >
            <p
              className="whitespace-pre-wrap text-[var(--foreground)] leading-[1.55]"
              style={{
                fontSize: "clamp(1.05rem, 2.2vw + 0.55rem, 2.05rem)",
                lineHeight: 1.55,
              }}
            >
              {current.paragraph_text}
            </p>
          </div>
          <p className="mt-6 text-center text-[11px] text-[var(--muted)] opacity-90">
            Flèches ou Page préc. / suiv. · Espace : suivant · Début : tout recommencer
          </p>
        </div>
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--overlay)] px-4 py-3 backdrop-blur-xl sm:px-6"
        aria-label="Navigation projection"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2 sm:justify-between sm:gap-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={goStart}
              disabled={atStart}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              Début
            </button>
            <button
              type="button"
              onClick={goPrev}
              disabled={atStart}
              className="min-h-[44px] min-w-[44px] rounded-full border border-[var(--border-strong)] bg-[var(--accent-soft)] px-5 py-2.5 text-sm font-semibold text-[var(--accent)] transition hover:border-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Précédent
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={atEnd}
              className="min-h-[44px] min-w-[44px] rounded-full border border-[var(--border-strong)] bg-[var(--accent-soft)] px-5 py-2.5 text-sm font-semibold text-[var(--accent)] transition hover:border-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Suivant
            </button>
          </div>
          <Link
            href={projectBase}
            className="hidden text-xs text-[var(--muted)] underline-offset-4 hover:text-[var(--foreground)] hover:underline sm:inline"
          >
            Lien depuis le début
          </Link>
        </div>
      </nav>
    </div>
  );
}
