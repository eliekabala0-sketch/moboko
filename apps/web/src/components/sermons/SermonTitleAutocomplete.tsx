"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Suggestion = {
  id: string;
  slug: string;
  title: string;
  year: number | null;
  preached_on: string | null;
  location: string | null;
  paragraph_count: number;
};

export function SermonTitleAutocomplete({ defaultValue, year, location }: { defaultValue: string; year: string; location: string }) {
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const query = value.trim();

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    if (query.length < 1) {
      setSuggestions([]);
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
        const params = new URLSearchParams({ q: query, limit: "10" });
        if (year.trim()) params.set("year", year.trim());
        if (location.trim()) params.set("location", location.trim());
        const res = await fetch(`/api/sermons/suggest?${params}`, { signal: controller.signal });
        const data = (await res.json()) as { suggestions?: Suggestion[] };
        setSuggestions(data.suggestions ?? []);
        setOpen(true);
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 80);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, year, location]);

  const status = useMemo(() => {
    if (loading) return "Recherche...";
    if (open && query && suggestions.length === 0) return "Aucune suggestion";
    return "";
  }, [loading, open, query, suggestions.length]);

  return (
    <div className="relative">
      <input
        name="st"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => query && setOpen(true)}
        placeholder="Ex. La Foi, Laodicee..."
        className="moboko-input mt-2"
        autoComplete="off"
      />
      {open && query ? (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface-elevated)] shadow-xl">
          {suggestions.map((item) => (
            <Link
              key={item.id}
              href={`/sermons/${encodeURIComponent(item.slug)}`}
              className="block border-b border-[var(--border)] px-4 py-3 text-sm transition last:border-b-0 hover:bg-[var(--accent-soft)]"
            >
              <span className="block font-semibold text-[var(--foreground)]">{item.title}</span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                {[item.preached_on, item.year, item.location].filter(Boolean).join(" - ") || "Sermon"}
              </span>
            </Link>
          ))}
          {status ? <p className="px-4 py-3 text-xs text-[var(--muted)]">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
