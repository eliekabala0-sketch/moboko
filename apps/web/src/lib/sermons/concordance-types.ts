/**
 * Données affichées côté client pour la concordance (chat + recherche IA sermons).
 * Texte des paragraphes : copie exacte base.
 */
export type ConcordanceHit = {
  slug: string;
  title: string;
  location: string | null;
  date: string | null;
  paragraph_number: number;
  paragraph_text: string;
  prev_paragraph_number: number | null;
  prev_paragraph_text: string | null;
  next_paragraph_number: number | null;
  next_paragraph_text: string | null;
  _source?: "chat" | "sermons-search";
  _query?: string;
  _conversation_id?: string;
  _offset?: number;
  _page_size?: number;
  _next_offset?: number | null;
  _has_more?: boolean;
  _total_count?: number;
};

export function hitKey(h: Pick<ConcordanceHit, "slug" | "paragraph_number">): string {
  return `${h.slug}:${h.paragraph_number}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

/** Retire une clôture Markdown ```json … ``` si présente. */
export function stripMarkdownJsonFence(s: string): string {
  let t = s.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/im.exec(t);
  if (fence?.[1]) t = fence[1].trim();
  return t;
}

function agentPrevNextText(o: Record<string, unknown>): {
  prevText: string | null;
  nextText: string | null;
} {
  let prevText: string | null =
    typeof o.prev_paragraph_text === "string" ? o.prev_paragraph_text : null;
  let nextText: string | null =
    typeof o.next_paragraph_text === "string" ? o.next_paragraph_text : null;
  if (prevText == null && "prev_paragraph" in o) {
    const p = o.prev_paragraph;
    if (typeof p === "string" && p.trim()) prevText = p;
    else if (p === null) prevText = null;
  }
  if (nextText == null && "next_paragraph" in o) {
    const n = o.next_paragraph;
    if (typeof n === "string" && n.trim()) nextText = n;
    else if (n === null) nextText = null;
  }
  return { prevText, nextText };
}

/** Interprète le JSON `metadata.results` renvoyé par l’API (tolérant). */
export function coerceConcordanceHits(raw: unknown): ConcordanceHit[] {
  if (!Array.isArray(raw)) return [];
  const out: ConcordanceHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const slug = typeof o.slug === "string" ? o.slug.trim() : "";
    const title = typeof o.title === "string" ? o.title : "";
    const paragraph_number = typeof o.paragraph_number === "number" ? o.paragraph_number : 0;
    const paragraph_text = typeof o.paragraph_text === "string" ? o.paragraph_text : "";
    if (!slug || !title || paragraph_number < 1 || !paragraph_text) continue;
    const loc = o.location;
    const po = o.preached_on;
    const yr = o.year;
    const dt = o.date;
    let date: string | null = null;
    if (typeof dt === "string" && dt.trim()) date = dt.trim();
    else if (typeof po === "string" && po.trim()) date = po.trim();
    else if (typeof yr === "number" && Number.isFinite(yr)) date = String(yr);
    const { prevText, nextText } = agentPrevNextText(o);
    let prev_paragraph_number =
      typeof o.prev_paragraph_number === "number" ? o.prev_paragraph_number : null;
    let next_paragraph_number =
      typeof o.next_paragraph_number === "number" ? o.next_paragraph_number : null;
    if (prevText != null && prev_paragraph_number == null && paragraph_number > 1) {
      prev_paragraph_number = paragraph_number - 1;
    }
    if (nextText != null && next_paragraph_number == null) {
      next_paragraph_number = paragraph_number + 1;
    }
    out.push({
      slug,
      title,
      location: typeof loc === "string" ? loc.trim() || null : null,
      date,
      paragraph_number,
      paragraph_text,
      prev_paragraph_number,
      prev_paragraph_text: prevText,
      next_paragraph_number,
      next_paragraph_text: nextText,
      _source:
        o._source === "chat" || o._source === "sermons-search"
          ? (o._source as "chat" | "sermons-search")
          : undefined,
      _query: typeof o._query === "string" ? o._query : undefined,
      _conversation_id: typeof o._conversation_id === "string" ? o._conversation_id : undefined,
      _offset: typeof o._offset === "number" ? o._offset : undefined,
      _page_size: typeof o._page_size === "number" ? o._page_size : undefined,
      _next_offset: typeof o._next_offset === "number" || o._next_offset === null ? (o._next_offset as number | null) : undefined,
      _has_more: typeof o._has_more === "boolean" ? o._has_more : undefined,
      _total_count: typeof o._total_count === "number" ? o._total_count : undefined,
    });
  }
  return out;
}

/** Sortie structurée attendue de l’agent OpenAI (chat concordance). */
export type ParsedChatAgentConcordance = {
  hits: ConcordanceHit[];
  total_count: number;
  offset: number;
  page_size: number;
  has_more: boolean;
  next_offset: number | null;
  continuation_message: string;
};

/**
 * Parse la sortie texte finale de l’agent : JSON nu, ```json```, tableau seul,
 * ou objet { total_count, shown_count, results, continuation }.
 */
export function parseChatAgentConcordanceOutput(raw: string): ParsedChatAgentConcordance | null {
  const t = stripMarkdownJsonFence(raw);
  if (!t) return null;
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }

  let resultsRaw: unknown[] | null = null;
  let envelope: Record<string, unknown> | null = null;

  if (Array.isArray(v)) {
    resultsRaw = v;
  } else if (isRecord(v) && Array.isArray(v.results)) {
    resultsRaw = v.results;
    envelope = v;
  } else {
    return null;
  }

  const hitsBase = coerceConcordanceHits(resultsRaw);
  if (hitsBase.length === 0) return null;

  const n = hitsBase.length;
  let total_count = n;
  let shown_count = n;
  let has_more = false;
  let continuation_message = "";

  if (envelope) {
    if (typeof envelope.total_count === "number" && Number.isFinite(envelope.total_count)) {
      total_count = Math.max(0, Math.floor(envelope.total_count));
    }
    if (typeof envelope.shown_count === "number" && Number.isFinite(envelope.shown_count)) {
      shown_count = Math.max(0, Math.floor(envelope.shown_count));
    }
    const cont = envelope.continuation;
    if (isRecord(cont)) {
      if (typeof cont.has_more === "boolean") has_more = cont.has_more;
      if (typeof cont.message === "string") continuation_message = cont.message.trim();
    } else {
      has_more = total_count > n;
    }
  } else if (typeof hitsBase[0]?._has_more === "boolean") {
    has_more = hitsBase[0]._has_more;
  }

  if (total_count < n) total_count = n;
  const page_size = Math.max(shown_count > 0 ? shown_count : n, 1);
  const first = hitsBase[0];
  let next_offset: number | null = null;
  if (has_more) {
    next_offset = typeof first?._next_offset === "number" ? first._next_offset : page_size;
  }

  const hits = hitsBase.map((h) => ({
    ...h,
    _offset: 0,
    _page_size: page_size,
    _total_count: total_count,
    _has_more: has_more,
    _next_offset: next_offset,
  }));

  return {
    hits,
    total_count,
    offset: 0,
    page_size,
    has_more,
    next_offset,
    continuation_message,
  };
}
