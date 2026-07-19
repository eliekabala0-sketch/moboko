"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type BibleHit = { translation: string; book: string; chapter: number; verse: number; text: string };

export function BibleQuickSearch({ version, book, defaultQuery }: { version: string; book: string; defaultQuery: string }) {
  const [q, setQ] = useState(defaultQuery);
  const [hits, setHits] = useState<BibleHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setQ(defaultQuery), [defaultQuery]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setOpen(false);
      abortRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query, version, limit: "12" });
        if (book) params.set("book", book);
        const res = await fetch(`/api/bible/search?${params}`, { signal: controller.signal });
        const data = (await res.json()) as { results?: BibleHit[] };
        setHits(data.results ?? []);
        setOpen(true);
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") setHits([]);
      } finally {
        setLoading(false);
      }
    }, 100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, version, book]);

  return (
    <div className="relative md:col-span-2">
      <label className="text-sm font-medium text-[var(--foreground)]">
        Recherche rapide par mot
        <input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          className="moboko-input mt-2"
          placeholder="Grace, pardon, Jean 3:16..."
          autoComplete="off"
        />
      </label>
      {open && q.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 z-30 mt-2 max-h-96 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-elevated)] shadow-xl">
          {hits.map((row) => (
            <Link
              key={`${row.translation}-${row.book}-${row.chapter}-${row.verse}`}
              href={`/bible?version=${row.translation}&book=${encodeURIComponent(row.book)}&chapter=${row.chapter}&q=${encodeURIComponent(`${row.book} ${row.chapter}:${row.verse}`)}`}
              className="block border-b border-[var(--border)] px-4 py-3 text-sm transition last:border-b-0 hover:bg-[var(--accent-soft)]"
            >
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                {row.book} {row.chapter}:{row.verse}
              </span>
              <span className="mt-1 line-clamp-2 block text-[var(--foreground)]">{row.text}</span>
            </Link>
          ))}
          {loading ? <p className="px-4 py-3 text-xs text-[var(--muted)]">Recherche...</p> : null}
          {!loading && hits.length === 0 ? <p className="px-4 py-3 text-xs text-[var(--muted)]">Aucun verset trouve</p> : null}
        </div>
      ) : null}
    </div>
  );
}
