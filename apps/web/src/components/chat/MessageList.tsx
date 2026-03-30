"use client";

import { ConcordanceHitsView } from "@/components/sermons/ConcordanceHitsView";
import { coerceConcordanceHits } from "@/lib/sermons/concordance-types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ChatAttachmentRecord } from "@moboko/shared";
import { useEffect, useState } from "react";
import { SermonSourceBlock } from "./SermonSourceBlock";

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "audio" | "image";
  content: string | null;
  created_at: string;
  attachments: ChatAttachmentRecord[];
  media_bucket: string | null;
  media_storage_path: string | null;
  media_mime: string | null;
  media_duration_ms: number | null;
  media_public_url: string | null;
  metadata: Record<string, unknown> | null;
};

function parseAttachments(raw: unknown): ChatAttachmentRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean) as ChatAttachmentRecord[];
}

function KindPill({ kind, mine }: { kind: UiMessage["kind"]; mine: boolean }) {
  if (kind === "text") return null;
  const label = kind === "image" ? "Image" : "Voix";
  return (
    <span
      className={`mb-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        mine
          ? "bg-white/15 text-white/90 ring-1 ring-white/20"
          : "bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--border-strong)]"
      }`}
    >
      {label}
    </span>
  );
}

function Bubble({
  msg,
  mediaSrc,
}: {
  msg: UiMessage;
  mediaSrc: string | null;
}) {
  const mine = msg.role === "user";
  const meta =
    !mine && msg.metadata && typeof msg.metadata === "object" && !Array.isArray(msg.metadata)
      ? (msg.metadata as Record<string, unknown>)
      : null;
  const hits =
    meta?.moboko_kind === "sermon_concordance" && Array.isArray(meta.results)
      ? coerceConcordanceHits(meta.results)
      : null;
  const concordanceEmpty = meta?.moboko_kind === "sermon_concordance_empty";
  const parsed =
    !mine && msg.kind === "text" && !hits?.length && !concordanceEmpty
      ? parseAssistantSermonSources(msg.content)
      : null;

  return (
    <div className={`flex w-full ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(85%,36rem)] rounded-2xl px-4 py-3 shadow-lg ${
          mine
            ? "rounded-br-md border border-[var(--border-strong)] bg-[linear-gradient(145deg,#2a3f66_0%,#243556_100%)] text-[#f4f6fb]"
            : "rounded-bl-md border border-[var(--chat-assistant-border)] bg-[var(--chat-assistant)] text-[var(--foreground)] backdrop-blur-sm"
        }`}
      >
        <div className="flex flex-col">
          <KindPill kind={msg.kind} mine={mine} />
          {msg.kind === "image" && mediaSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaSrc}
              alt=""
              className="mb-2 max-h-60 w-full rounded-xl object-cover ring-1 ring-black/20"
            />
          ) : null}
          {msg.kind === "audio" && mediaSrc ? (
            <audio
              src={mediaSrc}
              controls
              className="mb-2 h-9 w-full max-w-xs opacity-95"
            />
          ) : null}
          {hits && hits.length > 0 ? (
            <ConcordanceHitsView hits={hits} />
          ) : concordanceEmpty && msg.content ? (
            <p className="whitespace-pre-wrap text-[15px] leading-[1.65] tracking-[0.01em]">{msg.content}</p>
          ) : parsed ? (
            <div className="space-y-3">
              <div className="space-y-3">
                {parsed.sources.map((s, i) => (
                  <SermonSourceBlock
                    key={`${s.slug}-${s.paragraphNumber}-${i}`}
                    title={s.title}
                    slug={s.slug}
                    location={s.location}
                    date={s.date}
                    paragraphNumber={s.paragraphNumber}
                    paragraphText={s.paragraphText}
                  />
                ))}
              </div>
            </div>
          ) : msg.content ? (
            <p className="whitespace-pre-wrap text-[15px] leading-[1.65] tracking-[0.01em]">{msg.content}</p>
          ) : null}
          {!msg.content &&
          msg.kind !== "text" &&
          !mediaSrc &&
          !(hits && hits.length > 0) ? (
            <p className={`text-sm ${mine ? "text-white/75" : "text-[var(--muted)]"}`}>Média</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ParsedSource = {
  title: string;
  slug: string;
  location: string | null;
  date: string | null;
  paragraphNumber: number;
  paragraphText: string;
};

function parseAssistantSermonSources(content: string | null): {
  sources: ParsedSource[];
} | null {
  if (!content) return null;
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith("### source"));
  if (start < 0) return null;

  const sources: ParsedSource[] = [];
  let i = start;

  while (i < lines.length) {
    const h = lines[i]?.trim() ?? "";
    if (!h.toLowerCase().startsWith("### source")) {
      i += 1;
      continue;
    }
    i += 1;
    let title = "";
    let slug = "";
    let location: string | null = null;
    let date: string | null = null;
    let paragraphNumber = 0;

    while (i < lines.length) {
      const l = lines[i]?.trim() ?? "";
      if (!l) {
        i += 1;
        continue;
      }
      if (l.toLowerCase().startsWith("texte:")) {
        i += 1;
        break;
      }
      if (l.startsWith("- Titre:")) title = l.replace("- Titre:", "").trim();
      else if (l.startsWith("- Slug:")) slug = l.replace("- Slug:", "").trim();
      else if (l.startsWith("- Lieu:")) location = l.replace("- Lieu:", "").trim() || null;
      else if (l.startsWith("- Date:")) date = l.replace("- Date:", "").trim() || null;
      else if (l.startsWith("- Paragraphe:")) {
        const m = l.match(/§\s*(\d+)/);
        paragraphNumber = m ? Number(m[1]) : 0;
      }
      i += 1;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      const t = l.trim().toLowerCase();
      if (t.startsWith("### source")) break;
      paragraphLines.push(l);
      i += 1;
    }
    const paragraphText = paragraphLines.join("\n").trim();
    const resolvedSlug = slug || slugifyFromTitle(title);
    if (title && paragraphNumber > 0 && paragraphText && resolvedSlug) {
      sources.push({
        title,
        slug: resolvedSlug,
        location,
        date,
        paragraphNumber,
        paragraphText,
      });
    }
  }

  if (sources.length === 0) return null;
  return { sources };
}

function slugifyFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function MessageList({ messages }: { messages: UiMessage[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createSupabaseBrowserClient();
      const next: Record<string, string> = {};
      for (const m of messages) {
        if (m.media_public_url) {
          next[m.id] = m.media_public_url;
          continue;
        }
        if (
          m.media_bucket &&
          m.media_storage_path &&
          (m.kind === "image" || m.kind === "audio")
        ) {
          const { data, error } = await supabase.storage
            .from(m.media_bucket)
            .createSignedUrl(m.media_storage_path, 3600);
          if (!error && data?.signedUrl) next[m.id] = data.signedUrl;
        }
      }
      if (!cancelled) setUrls(next);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [messages]);

  return (
    <div className="flex flex-col gap-4 px-1 py-3 sm:px-2">
      {messages.map((m) => (
        <Bubble key={m.id} msg={m} mediaSrc={urls[m.id] ?? null} />
      ))}
    </div>
  );
}

export function mapRowToUiMessage(row: Record<string, unknown>): UiMessage {
  const rawMeta = row.metadata;
  const metadata =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      ? (rawMeta as Record<string, unknown>)
      : null;
  return {
    id: String(row.id),
    role: row.role as UiMessage["role"],
    kind: row.kind as UiMessage["kind"],
    content: (row.content as string) ?? null,
    created_at: String(row.created_at),
    attachments: parseAttachments(row.attachments),
    metadata,
    media_bucket: (row.media_bucket as string) ?? null,
    media_storage_path: (row.media_storage_path as string) ?? null,
    media_mime: (row.media_mime as string) ?? null,
    media_duration_ms:
      row.media_duration_ms == null ? null : Number(row.media_duration_ms),
    media_public_url: (row.media_public_url as string) ?? null,
  };
}
