"use client";

import type { ConcordanceHit } from "@/lib/sermons/concordance-types";
import { coerceConcordanceHits, hitKey } from "@/lib/sermons/concordance-types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function clipPreview(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

type Props = {
  hits: ConcordanceHit[];
  pageSize?: number;
  /** Id conversation (chat) : requis pour POST /api/ai/chat si les hits n’ont pas _conversation_id. */
  conversationId?: string | null;
};

export function ConcordanceHitsView({ hits, pageSize = 20, conversationId: conversationIdProp }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<ConcordanceHit[]>(hits);
  const [visible, setVisible] = useState(pageSize);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setItems(hits);
    setVisible(pageSize);
    setOpen(null);
  }, [hits, pageSize]);

  const selected = useMemo(
    () => (open ? items.find((h) => hitKey(h) === open) ?? null : null),
    [items, open],
  );

  const allHits = items.length > 0 ? items : hits;
  if (allHits.length === 0) return null;
  const visibleHits = allHits.slice(0, Math.max(pageSize, visible));
  const lastMeta = allHits[allHits.length - 1];
  const hasServerMore = Boolean(lastMeta?._has_more && typeof lastMeta?._next_offset === "number");
  const canLoadMore = hasServerMore || visibleHits.length < allHits.length;

  async function loadMore() {
    if (loadingMore) return;
    if (!hasServerMore) {
      setVisible((v) => v + pageSize);
      return;
    }
    const query = lastMeta?._query?.trim() ?? "";
    const nextOffset = typeof lastMeta?._next_offset === "number" ? lastMeta._next_offset : null;
    const serverPageSize =
      typeof lastMeta?._page_size === "number" && lastMeta._page_size > 0 ? lastMeta._page_size : pageSize;
    if (!query || nextOffset == null) {
      setVisible((v) => v + pageSize);
      return;
    }

    const endpoint = lastMeta?._source === "chat" ? "/api/ai/chat" : "/api/ai/sermons-search";
    const fromProp = typeof conversationIdProp === "string" ? conversationIdProp.trim() : "";
    const fromHit =
      typeof lastMeta?._conversation_id === "string" ? lastMeta._conversation_id.trim() : "";
    const conversationIdForChat = fromProp || fromHit || null;
    if (endpoint === "/api/ai/chat" && !conversationIdForChat) {
      setVisible((v) => v + pageSize);
      return;
    }

    setLoadingMore(true);
    try {
      const payload: Record<string, unknown> =
        endpoint === "/api/ai/chat"
          ? {
              mode: "concordance_page",
              conversationId: conversationIdForChat,
              query,
              offset: nextOffset,
              pageSize: serverPageSize,
            }
          : {
              query,
              offset: nextOffset,
              pageSize: serverPageSize,
            };
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setVisible((v) => v + pageSize);
        return;
      }
      const data = (await res.json()) as Record<string, unknown>;
      const nextHits = coerceConcordanceHits(data.results);
      if (nextHits.length === 0) {
        setVisible((v) => v + pageSize);
        return;
      }
      setItems((prev) => [...prev, ...nextHits]);
      setVisible((v) => v + nextHits.length);
    } finally {
      setLoadingMore(false);
    }
  }

  if (selected) {
    const slugEnc = encodeURIComponent(selected.slug);
    const readHref = `/sermons/${slugEnc}#p-${selected.paragraph_number}`;
    const projectHref = `/sermons/${slugEnc}/project?p=${selected.paragraph_number}`;

    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setOpen(null)}
          className="text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
        >
          ← Retour à la liste
        </button>

        <article className="moboko-card p-5 sm:p-6">
          <p className="font-medium text-[var(--foreground)]">{selected.title}</p>
          <p className="mt-1 text-xs text-[var(--accent)]">
            §{selected.paragraph_number}
            {selected.location ? ` · ${selected.location}` : ""}
            {selected.date ? ` · ${selected.date}` : ""}
          </p>

          {selected.prev_paragraph_text != null && selected.prev_paragraph_number != null ? (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]/50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Paragraphe §{selected.prev_paragraph_number} (précédent)
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                {selected.prev_paragraph_text}
              </p>
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)]/30 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              Paragraphe trouvé §{selected.paragraph_number}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--foreground)]">
              {selected.paragraph_text}
            </p>
          </div>

          {selected.next_paragraph_text != null && selected.next_paragraph_number != null ? (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]/50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Paragraphe §{selected.next_paragraph_number} (suivant)
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                {selected.next_paragraph_text}
              </p>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={readHref}
              className="moboko-btn-primary inline-flex px-5 py-2.5 text-center text-[13px]"
            >
              Lire
            </Link>
            <Link
              href={projectHref}
              className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-2.5 text-[13px] font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)]/40"
            >
              Projeter
            </Link>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] font-semibold tracking-tight text-[var(--foreground)]">
        Résultats trouvés ({lastMeta?._total_count ?? allHits.length})
      </p>
      <ul className="space-y-2">
      {visibleHits.map((h) => {
        const k = hitKey(h);
        return (
          <li key={k}>
            <button
              type="button"
              onClick={() => setOpen(k)}
              className="moboko-card w-full p-4 text-left transition hover:border-[var(--border-strong)]"
            >
              <p className="font-medium text-[var(--foreground)]">{h.title}</p>
              <p className="mt-1 text-[11px] text-[var(--accent)]">
                §{h.paragraph_number}
                {h.location ? ` · ${h.location}` : ""}
                {h.date ? ` · ${h.date}` : ""}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{clipPreview(h.paragraph_text)}</p>
            </button>
          </li>
        );
      })}
      </ul>
      {canLoadMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="inline-flex items-center rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--border-strong)]"
        >
          {loadingMore
            ? "Chargement…"
            : `Voir plus (${Math.max((lastMeta?._total_count ?? allHits.length) - visibleHits.length, 0)} restants)`}
        </button>
      ) : null}
    </div>
  );
}
