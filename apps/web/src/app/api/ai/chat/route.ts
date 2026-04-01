import {
  getChatModel,
  getOpenAIClient,
  historyToOpenAIMessages,
  runChatCompletion,
  runStructuredJsonCompletion,
  transcribeAudio,
  type DbMessageRow,
} from "@/lib/ai/moboko-chat";
import {
  clipForPrompt,
  fetchSermonSearchCandidates,
  type SermonParagraphCandidate,
} from "@/lib/sermons/ai-sermon-search-server";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ALL_PUBLIC_APP_SETTING_KEYS,
  parseAppSettingScalar,
  PUBLIC_APP_SETTING_KEYS,
} from "@moboko/shared";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  conversationId: string;
  mode: "text" | "image" | "audio" | "concordance_page";
  text?: string;
  query?: string;
  offset?: number;
  pageSize?: number;
  imageStoragePath?: string;
  imageMime?: string;
  audioStoragePath?: string;
  audioMime?: string;
  audioDurationMs?: number;
};

const CONCORDANCE_PAGE_SIZE = 20;

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const conversationId = typeof o.conversationId === "string" ? o.conversationId : "";
  const mode = o.mode;
  if (
    !conversationId ||
    (mode !== "text" && mode !== "image" && mode !== "audio" && mode !== "concordance_page")
  ) {
    return null;
  }
  const offset = typeof o.offset === "number" && Number.isFinite(o.offset) ? Math.max(0, Math.floor(o.offset)) : 0;
  const requestedPageSize =
    typeof o.pageSize === "number" && Number.isFinite(o.pageSize)
      ? Math.floor(o.pageSize)
      : CONCORDANCE_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(50, requestedPageSize));
  return {
    conversationId,
    mode,
    text: typeof o.text === "string" ? o.text : undefined,
    query: typeof o.query === "string" ? o.query : undefined,
    offset,
    pageSize,
    imageStoragePath:
      typeof o.imageStoragePath === "string" ? o.imageStoragePath : undefined,
    imageMime: typeof o.imageMime === "string" ? o.imageMime : undefined,
    audioStoragePath:
      typeof o.audioStoragePath === "string" ? o.audioStoragePath : undefined,
    audioMime: typeof o.audioMime === "string" ? o.audioMime : undefined,
    audioDurationMs:
      typeof o.audioDurationMs === "number" ? o.audioDurationMs : undefined,
  };
}

function pathBelongsToUser(path: string, userId: string) {
  return path.startsWith(`${userId}/`);
}

type SemanticIntent = {
  search_mode:
    | "exact_quote_search"
    | "theme_search"
    | "situation_search"
    | "story_search"
    | "prayer_search"
    | "doctrinal_search"
    | "time_bounded_search"
    | "preaching_prep_search"
    | "comfort_or_exhortation_search"
    | "sermon_title_then_topic_search";
  user_need:
    | "simple_answer"
    | "orientation"
    | "exhortation"
    | "comfort"
    | "preaching_prep"
    | "citation_list"
    | "prayer_list"
    | "story_list";
  intent: string;
  topic: string;
  concepts: string[];
  expansions: string[];
  content_types: string[];
  quoted_phrase: string | null;
  sermon_hint: string | null;
  year_from: number | null;
  year_to: number | null;
  maybe_meant: string | null;
};

type AiPick = { i?: number };

const EMPTY_CONCORDANCE_MESSAGE = "Aucun paragraphe exact trouvé pour cette recherche.";

const MOBOKO_SOURCE_ONLY_LOCK = `Règles Moboko (impératif) :
- Moboko ne doit jamais utiliser des connaissances générales.
- Moboko ne répond que par des passages présents dans la base.
- Si aucun passage n’est trouvé dans les extraits fournis, Moboko ne répond pas à l’utilisateur : produis uniquement le JSON demandé sans autre texte, par ex. {"picks":[]}.`;

function parseSemanticIntent(raw: string): SemanticIntent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const modeRaw =
    typeof o.search_mode === "string" ? o.search_mode.trim() : "theme_search";
  const search_mode: SemanticIntent["search_mode"] = (
    [
      "exact_quote_search",
      "theme_search",
      "situation_search",
      "story_search",
      "prayer_search",
      "doctrinal_search",
      "time_bounded_search",
      "preaching_prep_search",
      "comfort_or_exhortation_search",
      "sermon_title_then_topic_search",
    ] as const
  ).includes(modeRaw as SemanticIntent["search_mode"])
    ? (modeRaw as SemanticIntent["search_mode"])
    : "theme_search";
  const needRaw =
    typeof o.user_need === "string" ? o.user_need.trim() : "orientation";
  const user_need: SemanticIntent["user_need"] = (
    [
      "simple_answer",
      "orientation",
      "exhortation",
      "comfort",
      "preaching_prep",
      "citation_list",
      "prayer_list",
      "story_list",
    ] as const
  ).includes(needRaw as SemanticIntent["user_need"])
    ? (needRaw as SemanticIntent["user_need"])
    : "orientation";
  const intent = typeof o.intent === "string" ? o.intent.trim().slice(0, 240) : "";
  const topic = typeof o.topic === "string" ? o.topic.trim().slice(0, 200) : "";
  const maybe_meant = typeof o.maybe_meant === "string" ? o.maybe_meant.trim().slice(0, 240) : null;
  const quoted_phrase =
    typeof o.quoted_phrase === "string" ? o.quoted_phrase.trim().slice(0, 240) : null;
  const sermon_hint =
    typeof o.sermon_hint === "string" ? o.sermon_hint.trim().slice(0, 240) : null;
  const year_from =
    typeof o.year_from === "number" && Number.isFinite(o.year_from)
      ? Math.max(1900, Math.min(2100, Math.floor(o.year_from)))
      : null;
  const year_to =
    typeof o.year_to === "number" && Number.isFinite(o.year_to)
      ? Math.max(1900, Math.min(2100, Math.floor(o.year_to)))
      : null;
  const concepts = Array.isArray(o.concepts)
    ? o.concepts
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const expansions = Array.isArray(o.expansions)
    ? o.expansions
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const content_types = Array.isArray(o.content_types)
    ? o.content_types
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return {
    search_mode,
    user_need,
    intent,
    topic,
    concepts,
    expansions,
    content_types,
    quoted_phrase,
    sermon_hint,
    year_from,
    year_to,
    maybe_meant,
  };
}

function parseAiPicks(raw: string, n: number): { picks: AiPick[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const arr = o.picks;
  if (!Array.isArray(arr)) return { picks: [] };
  const picks: AiPick[] = [];
  const used = new Set<number>();
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    const i = typeof p.i === "number" && Number.isInteger(p.i) ? p.i : null;
    if (i === null || i < 1 || i > n || used.has(i)) continue;
    used.add(i);
    picks.push({ i });
    if (picks.length >= 8) break;
  }
  return { picks };
}

async function enrichRankedWithNeighbors(
  admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  ranked: { c: SermonParagraphCandidate }[],
  query: string,
  offset: number,
  pageSize: number,
  conversationId: string,
) {
  const end = Math.min(ranked.length, offset + pageSize);
  const page = ranked.slice(offset, end);
  const results: Record<string, unknown>[] = [];
  const hasMore = end < ranked.length;
  for (const { c } of page) {
    const n = await fetchNeighborParagraphs(admin, c.slug, c.paragraph_number);
    results.push({
      slug: c.slug,
      title: c.title,
      location: c.location ?? null,
      date:
        (c.preached_on && String(c.preached_on).trim()) ||
        (c.year != null ? String(c.year) : null),
      paragraph_number: c.paragraph_number,
      paragraph_text: c.paragraph_text,
      prev_paragraph_number: n.prev_paragraph_number,
      prev_paragraph_text: n.prev_paragraph_text,
      next_paragraph_number: n.next_paragraph_number,
      next_paragraph_text: n.next_paragraph_text,
      _source: "chat",
      _query: query,
      _conversation_id: conversationId,
      _offset: offset,
      _page_size: pageSize,
      _next_offset: hasMore ? end : null,
      _has_more: hasMore,
      _total_count: ranked.length,
    });
  }
  return { results, totalCount: ranked.length, hasMore, nextOffset: hasMore ? end : null };
}

async function extractSemanticIntent(
  openai: NonNullable<ReturnType<typeof getOpenAIClient>>,
  query: string,
): Promise<SemanticIntent | null> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${MOBOKO_SOURCE_ONLY_LOCK}

Tu analyses une question française UNIQUEMENT pour produire des paramètres de recherche (aucune réponse à l’utilisateur, aucun sermon inventé).
Retourne UNIQUEMENT un JSON :
{"search_mode":"...","user_need":"...","intent":"...","topic":"...","concepts":["..."],"expansions":["..."],"content_types":["..."],"quoted_phrase":"...|null","sermon_hint":"...|null","year_from":1963|null,"year_to":1965|null,"maybe_meant":"...|null"}
search_mode parmi: exact_quote_search, theme_search, situation_search, story_search, prayer_search, doctrinal_search, time_bounded_search, preaching_prep_search, comfort_or_exhortation_search, sermon_title_then_topic_search.
user_need parmi: simple_answer, orientation, exhortation, comfort, preaching_prep, citation_list, prayer_list, story_list.
Règles:
- tolérance forte aux fautes d’orthographe, fautes de frappe, accents manquants, phrases incomplètes et mots-clés isolés.
- relier les formulations approximatives à l’idée probable (ex: "prophete" => "prophète", "dime" => "dîme", "q dit le prophete sur boire" => alcool/vin/sobriété/tempérance).
- Ne pas inventer de sources.`,
    },
    { role: "user", content: query },
  ];
  const raw = await runStructuredJsonCompletion(openai, messages, {
    maxTokens: 280,
    temperature: 0.1,
    timeoutMs: 22_000,
  });
  if (!raw) return null;
  return parseSemanticIntent(raw);
}

async function fetchSemanticCandidates(
  admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  query: string,
  semantic: SemanticIntent | null,
) {
  const typeExpansions =
    semantic?.search_mode === "prayer_search"
      ? ["prière", "prions", "je prie", "prayer line", "ligne de prière"]
      : semantic?.search_mode === "story_search"
        ? ["histoire", "récit", "témoignage", "il raconta", "il dit"]
        : semantic?.search_mode === "comfort_or_exhortation_search"
          ? ["consolation", "réconfort", "fortifie", "encouragement", "espérance"]
          : [];
  const quoted = semantic?.quoted_phrase ? [semantic.quoted_phrase] : [];
  const titleThenTopic =
    semantic?.search_mode === "sermon_title_then_topic_search" && semantic?.sermon_hint
      ? [`${semantic.sermon_hint} ${semantic.topic || query}`]
      : [];
  const queries = [
    query,
    semantic?.intent ?? "",
    semantic?.topic ?? "",
    ...quoted,
    ...titleThenTopic,
    ...(semantic?.expansions ?? []),
    ...(semantic?.concepts ?? []),
    ...typeExpansions,
  ]
    .map((x) => x.trim())
    .filter((x, i, arr) => x.length >= 3 && arr.indexOf(x) === i)
    .slice(0, 24);
  const MAX_CANDIDATES = 900;
  const byKey = new Map<string, SermonParagraphCandidate>();
  const collect = async (q: string) => {
    const rows = await fetchSermonSearchCandidates(admin, q);
    for (const c of rows) {
      const k = `${c.slug}:${c.paragraph_number}`;
      if (!byKey.has(k)) byKey.set(k, c);
      if (byKey.size >= MAX_CANDIDATES) break;
    }
  };
  for (const q of queries.slice(0, 6)) {
    await collect(q);
    if (byKey.size >= 320) break;
  }
  if (byKey.size < 620) {
    for (const q of queries.slice(6, 16)) {
      await collect(q);
      if (byKey.size >= 700) break;
    }
  }
  if (byKey.size < 700) {
    const broad = [
      semantic?.topic ?? "",
      semantic?.intent ?? "",
      ...(semantic?.concepts ?? []).slice(0, 5),
    ]
      .filter(Boolean)
      .join(" ");
    if (broad.trim().length >= 3) await collect(broad);
    for (const q of queries.slice(16)) {
      await collect(q);
      if (byKey.size >= MAX_CANDIDATES) break;
    }
  }
  let out = Array.from(byKey.values());
  if (semantic?.year_from != null || semantic?.year_to != null) {
    const minY = semantic.year_from ?? 1900;
    const maxY = semantic.year_to ?? 2100;
    out = out.filter((c) => c.year == null || (c.year >= minY && c.year <= maxY));
  }
  const hasType = (txt: string, needles: string[]) =>
    needles.some((n) => txt.includes(n));
  const score = (c: SermonParagraphCandidate) => {
    const t = c.paragraph_text.toLowerCase();
    let s = 0;
    if (semantic?.search_mode === "exact_quote_search" && semantic.quoted_phrase) {
      if (t.includes(semantic.quoted_phrase.toLowerCase())) s += 12;
    }
    if (semantic?.search_mode === "prayer_search" || semantic?.content_types.includes("prayer")) {
      if (hasType(t, ["prions", "prière", "je prie", "amen"])) s += 6;
    }
    if (semantic?.search_mode === "story_search" || semantic?.content_types.includes("story")) {
      if (hasType(t, ["histoire", "récit", "témoign", "il dit", "il raconta"])) s += 5;
    }
    if (semantic?.search_mode === "comfort_or_exhortation_search") {
      if (hasType(t, ["consol", "réconfort", "fortifie", "espérance"])) s += 4;
    }
    if (semantic?.topic && t.includes(semantic.topic.toLowerCase())) s += 3;
    return s;
  };
  out.sort((a, b) => score(b) - score(a));
  return out.slice(0, MAX_CANDIDATES);
}

function buildRankingPrompt(query: string, semantic: SemanticIntent | null, candidates: SermonParagraphCandidate[]) {
  const lines = candidates.map((c, idx) => {
    const y = c.year != null ? String(c.year) : "";
    return `${idx + 1}\t${c.slug}\t${c.title}\t${y}\t${c.paragraph_number}\t${clipForPrompt(c.paragraph_text, 320)}`;
  });
  return [
    `Question: ${query}`,
    `Intent: ${semantic?.intent || "(non déterminé)"}`,
    `Mode: ${semantic?.search_mode || "theme_search"}`,
    `Besoin: ${semantic?.user_need || "orientation"}`,
    `Concepts: ${(semantic?.concepts ?? []).join(", ") || "(aucun)"}`,
    "",
    "Extraits candidats (n° | slug | titre | année | paragraphe | extrait):",
    lines.join("\n"),
  ].join("\n");
}

async function maybeInjectSermonContext(
  completionMessages: ChatCompletionMessageParam[],
  queryText: string | null,
  admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
) {
  const q = (queryText ?? "").trim();
  if (q.length < 10) return 0;
  const candidates = await fetchSermonSearchCandidates(admin, q);
  if (candidates.length === 0) return 0;
  const top = candidates.slice(0, 4);
  const lines = top.map((c, idx) => {
    const y = c.year != null ? ` (${c.year})` : "";
    return `${idx + 1}. ${c.title}${y} §${c.paragraph_number}\n${clipForPrompt(c.paragraph_text, 420)}`;
  });
  completionMessages.push({
    role: "system",
    content:
      "Contexte sermons disponibles (extraits vérifiés de la base Moboko ; n'invente pas au-delà) :\n\n" +
      lines.join("\n\n"),
  });
  return top.length;
}

export async function POST(request: Request) {
  const openai = getOpenAIClient();
  if (!openai) {
    return NextResponse.json(
      { error: "openai_non_configure", detail: "OPENAI_API_KEY manquante côté serveur." },
      { status: 503 },
    );
  }

  const admin = createSupabaseServiceClient();
  if (!admin) {
    return NextResponse.json(
      { error: "service_supabase_manquant", detail: "SUPABASE_SERVICE_ROLE_KEY requise." },
      { status: 500 },
    );
  }

  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) {
    return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  }

  let body: Body;
  try {
    const json = (await request.json()) as unknown;
    const p = parseBody(json);
    if (!p) {
      return NextResponse.json({ error: "corps_invalide" }, { status: 400 });
    }
    body = p;
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .select("id, user_id")
    .eq("id", body.conversationId)
    .maybeSingle();

  if (convErr || !conv || conv.user_id !== user.id) {
    return NextResponse.json({ error: "conversation_inaccessible" }, { status: 403 });
  }

  if (body.mode === "concordance_page") {
    const query = (body.query ?? "").trim();
    if (!query) {
      return NextResponse.json({ error: "requete_pagination_invalide" }, { status: 400 });
    }
    const offset = Math.max(0, Math.floor(body.offset ?? 0));
    const pageSize = Math.max(1, Math.min(50, Math.floor(body.pageSize ?? CONCORDANCE_PAGE_SIZE)));

    let semantic: SemanticIntent | null = null;
    try {
      semantic = await extractSemanticIntent(openai, query);
    } catch {
      semantic = null;
    }
    const candidates = await fetchSemanticCandidates(admin, query, semantic);
    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        results: [],
        total_count: 0,
        offset,
        page_size: pageSize,
        has_more: false,
        next_offset: null,
        message: EMPTY_CONCORDANCE_MESSAGE,
      });
    }

    const rerankPool = candidates.slice(0, 260);
    let rankRaw = "";
    try {
      rankRaw = await runStructuredJsonCompletion(
        openai,
        [
          {
            role: "system",
            content: `${MOBOKO_SOURCE_ONLY_LOCK}

Tu classes des extraits de sermons par pertinence (liste numérotée fournie).
Réponds UNIQUEMENT par un JSON valide : {"picks":[{"i":1},...]}
Maximum 8 indices, du plus pertinent au moins pertinent. Chaque i doit être présent dans la liste.
Aucune phrase hors JSON, aucun champ supplémentaire. Si rien ne convient : {"picks":[]}.`,
          },
          { role: "user", content: buildRankingPrompt(query, semantic, rerankPool) },
        ],
        { maxTokens: 360, temperature: 0.08, timeoutMs: 28_000 },
      );
    } catch {
      rankRaw = "";
    }
    const parsed = rankRaw ? parseAiPicks(rankRaw, rerankPool.length) : null;
    const aiRanked = (parsed?.picks ?? [])
      .filter((p): p is { i: number } => typeof p.i === "number")
      .map((p) => rerankPool[p.i - 1])
      .filter((c): c is SermonParagraphCandidate => Boolean(c));
    const aiKeys = new Set(aiRanked.map((c) => `${c.slug}:${c.paragraph_number}`));
    const ordered = [...aiRanked, ...candidates.filter((c) => !aiKeys.has(`${c.slug}:${c.paragraph_number}`))];
    const ranked = ordered
      .map((c) => ({ c }))
      .filter((x): x is { c: SermonParagraphCandidate } => Boolean(x.c));

    const page = await enrichRankedWithNeighbors(
      admin,
      ranked,
      query,
      offset,
      pageSize,
      body.conversationId,
    );
    return NextResponse.json({
      ok: true,
      results: page.results,
      total_count: page.totalCount,
      offset,
      page_size: pageSize,
      has_more: page.hasMore,
      next_offset: page.nextOffset,
      message: page.totalCount === 0 ? EMPTY_CONCORDANCE_MESSAGE : null,
    });
  }

  const { data: settingRows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ALL_PUBLIC_APP_SETTING_KEYS);

  const settings: Record<string, ReturnType<typeof parseAppSettingScalar>> = {};
  for (const k of ALL_PUBLIC_APP_SETTING_KEYS) {
    settings[k] = null;
  }
  for (const row of settingRows ?? []) {
    settings[row.key] = parseAppSettingScalar(row.value);
  }

  const chatText = Boolean(settings[PUBLIC_APP_SETTING_KEYS.chatTextEnabled]);
  const chatVoice = Boolean(settings[PUBLIC_APP_SETTING_KEYS.chatVoiceEnabled]);
  const chatImage = Boolean(settings[PUBLIC_APP_SETTING_KEYS.chatImageEnabled]);
  const costText = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.textCreditCost] ?? 1)),
  );
  const costVoice = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.voiceCreditCost] ?? 2)),
  );
  const costImage = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.imageCreditCost] ?? 3)),
  );

  if (body.mode === "text" && !chatText) {
    return NextResponse.json({ error: "chat_texte_desactive" }, { status: 403 });
  }
  if (body.mode === "image" && !chatImage) {
    return NextResponse.json({ error: "chat_image_desactive" }, { status: 403 });
  }
  if (body.mode === "audio" && !chatVoice) {
    return NextResponse.json({ error: "chat_voix_desactive" }, { status: 403 });
  }

  let creditCost = 0;
  if (body.mode === "text") creditCost = costText;
  else if (body.mode === "image") creditCost = costImage;
  else creditCost = costVoice;

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("credit_balance, is_premium, is_free_access")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: "profil_introuvable" }, { status: 500 });
  }

  const balance = profile.credit_balance ?? 0;
  const billingExempt = Boolean(profile.is_free_access || profile.is_premium);

  if (!billingExempt && creditCost > 0 && balance < creditCost) {
    return NextResponse.json(
      {
        error: "credits_insuffisants",
        message: `Il vous faut ${creditCost} crédit(s) pour cette action (solde : ${balance}).`,
        balance,
        required: creditCost,
      },
      { status: 402 },
    );
  }

  const { data: historyRows, error: histErr } = await admin
    .from("messages")
    .select("role, kind, content")
    .eq("conversation_id", body.conversationId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (histErr) {
    return NextResponse.json({ error: "historique_lecture" }, { status: 500 });
  }

  const history = (historyRows ?? []) as DbMessageRow[];
  const openaiMessages = historyToOpenAIMessages(history);

  let userContent: string | null = null;
  const userKind: "text" | "image" | "audio" = body.mode;
  let attachments: unknown[] = [];
  let media_bucket: string | null = null;
  let media_storage_path: string | null = null;
  let media_mime: string | null = null;
  let media_duration_ms: number | null = null;
  let metadataUser: Record<string, unknown> = {};
  const completionMessages: ChatCompletionMessageParam[] = [...openaiMessages];

  try {
    if (body.mode === "text") {
      const t = (body.text ?? "").trim();
      if (!t) {
        return NextResponse.json({ error: "texte_vide" }, { status: 400 });
      }
      userContent = t;
    } else if (body.mode === "image") {
      const path = body.imageStoragePath?.trim();
      if (!path || !pathBelongsToUser(path, user.id)) {
        return NextResponse.json({ error: "chemin_image_invalide" }, { status: 400 });
      }
      const mime = body.imageMime?.trim() || "image/jpeg";
      const { data: fileData, error: dlErr } = await admin.storage
        .from("chat-images")
        .download(path);
      if (dlErr || !fileData) {
        return NextResponse.json({ error: "telechargement_image" }, { status: 400 });
      }
      const buf = Buffer.from(await fileData.arrayBuffer());
      const b64 = buf.toString("base64");
      const dataUrl = `data:${mime};base64,${b64}`;
      const question = (body.text ?? "").trim() || "Que vois-tu sur cette image ? Réponds de façon utile et sobre.";
      userContent = question;
      attachments = [{ bucket: "chat-images", path, mime }];
      media_bucket = "chat-images";
      media_storage_path = path;
      media_mime = mime;
      completionMessages.push({
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      });
    } else {
      const path = body.audioStoragePath?.trim();
      if (!path || !pathBelongsToUser(path, user.id)) {
        return NextResponse.json({ error: "chemin_audio_invalide" }, { status: 400 });
      }
      const mime = body.audioMime?.trim() || "audio/webm";
      const { data: fileData, error: dlErr } = await admin.storage
        .from("chat-audio")
        .download(path);
      if (dlErr || !fileData) {
        return NextResponse.json({ error: "telechargement_audio" }, { status: 400 });
      }
      const buf = Buffer.from(await fileData.arrayBuffer());
      const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "m4a" : "audio";
      const transcription = await transcribeAudio(openai, buf, `clip.${ext}`, mime);
      if (!transcription) {
        return NextResponse.json({ error: "transcription_vide" }, { status: 422 });
      }
      userContent = transcription;
      media_duration_ms =
        body.audioDurationMs != null && Number.isFinite(body.audioDurationMs)
          ? Math.floor(body.audioDurationMs)
          : null;
      attachments = [
        {
          bucket: "chat-audio",
          path,
          mime,
          duration_ms: media_duration_ms,
        },
      ];
      media_bucket = "chat-audio";
      media_storage_path = path;
      media_mime = mime;
      metadataUser = { transcription_model: "whisper-1" };
      completionMessages.push({ role: "user", content: transcription });
    }

    let assistantText = "";
    let sermonContextCount = 0;
    let metaAssistant: Record<string, unknown> = {
      model: getChatModel(),
      sermon_context_count: 0,
    };

    if (body.mode === "text" && userContent) {
      try {
        let semantic: SemanticIntent | null = null;
        try {
          semantic = await extractSemanticIntent(openai, userContent);
        } catch {
          semantic = null;
        }

        const candidates = await fetchSemanticCandidates(admin, userContent, semantic);
        sermonContextCount = candidates.length;

        if (candidates.length > 0) {
          const rerankPool = candidates.slice(0, 260);
          let rankRaw: string;
          try {
            rankRaw = await runStructuredJsonCompletion(
              openai,
              [
                {
                  role: "system",
                  content: `${MOBOKO_SOURCE_ONLY_LOCK}

Tu classes des extraits de sermons par pertinence (liste numérotée fournie).
Réponds UNIQUEMENT par un JSON valide : {"picks":[{"i":1},...]}
Maximum 8 indices, du plus pertinent au moins pertinent. Chaque i doit être présent dans la liste.
Aucune phrase hors JSON, aucun champ supplémentaire. Si rien ne convient : {"picks":[]}.`,
                },
                { role: "user", content: buildRankingPrompt(userContent, semantic, rerankPool) },
              ],
              { maxTokens: 360, temperature: 0.08, timeoutMs: 28_000 },
            );
          } catch (rankErrOn) {
            console.error("[api/ai/chat] classement_ia", rankErrOn);
            rankRaw = "";
          }

          const parsed = rankRaw ? parseAiPicks(rankRaw, rerankPool.length) : null;
          const pickList = parsed?.picks ?? [];
          const aiRanked = pickList
            .filter((p): p is { i: number } => typeof p.i === "number")
            .map((p) => rerankPool[p.i - 1])
            .filter((c): c is SermonParagraphCandidate => Boolean(c));
          const aiKeys = new Set(aiRanked.map((c) => `${c.slug}:${c.paragraph_number}`));
          const ordered = [...aiRanked, ...candidates.filter((c) => !aiKeys.has(`${c.slug}:${c.paragraph_number}`))];
          const ranked = ordered
            .map((c) => ({ c }))
            .filter((x): x is { c: SermonParagraphCandidate } => Boolean(x.c));

          if (ranked.length === 0) {
            assistantText = EMPTY_CONCORDANCE_MESSAGE;
            metaAssistant = {
              model: getChatModel(),
              sermon_context_count: sermonContextCount,
              moboko_kind: "sermon_concordance_empty",
            };
          } else {
            const page = await enrichRankedWithNeighbors(
              admin,
              ranked,
              userContent,
              0,
              CONCORDANCE_PAGE_SIZE,
              body.conversationId,
            );
            assistantText = "";
            metaAssistant = {
              model: getChatModel(),
              sermon_context_count: sermonContextCount,
              moboko_kind: "sermon_concordance",
              results: page.results,
              total_count: page.totalCount,
              offset: 0,
              page_size: CONCORDANCE_PAGE_SIZE,
              has_more: page.hasMore,
              next_offset: page.nextOffset,
            };
          }
        } else {
          assistantText = EMPTY_CONCORDANCE_MESSAGE;
          metaAssistant = {
            model: getChatModel(),
            sermon_context_count: 0,
            moboko_kind: "sermon_concordance_empty",
          };
        }
      } catch (e) {
        console.error("[api/ai/chat] pipeline_sermons", e);
        sermonContextCount = 0;
        assistantText = EMPTY_CONCORDANCE_MESSAGE;
        metaAssistant = {
          model: getChatModel(),
          sermon_context_count: 0,
          moboko_kind: "sermon_concordance_empty",
        };
      }
    } else {
      sermonContextCount = await maybeInjectSermonContext(
        completionMessages,
        userContent,
        admin,
      );
      assistantText = await runChatCompletion(openai, completionMessages);
      metaAssistant = {
        model: getChatModel(),
        sermon_context_count: sermonContextCount,
      };
    }

    const hasConcordanceList =
      metaAssistant.moboko_kind === "sermon_concordance" &&
      Array.isArray(metaAssistant.results) &&
      (metaAssistant.results as unknown[]).length > 0;
    const hasConcordanceEmpty =
      metaAssistant.moboko_kind === "sermon_concordance_empty" &&
      assistantText.trim() === EMPTY_CONCORDANCE_MESSAGE;

    if (assistantText.trim().length === 0 && !hasConcordanceList && !hasConcordanceEmpty) {
      return NextResponse.json({ error: "reponse_ia_vide" }, { status: 502 });
    }

    const { data: userIns, error: uErr } = await admin
      .from("messages")
      .insert({
        conversation_id: body.conversationId,
        role: "user",
        kind: userKind,
        content: userContent,
        attachments,
        metadata: metadataUser,
        media_bucket,
        media_storage_path,
        media_mime,
        media_duration_ms,
        media_public_url: null,
      })
      .select("id")
      .single();

    if (uErr || !userIns) {
      return NextResponse.json({ error: "insertion_message_utilisateur" }, { status: 500 });
    }

    const { data: asstIns, error: aErr } = await admin
      .from("messages")
      .insert({
        conversation_id: body.conversationId,
        role: "assistant",
        kind: "text",
        content: assistantText,
        attachments: [],
        metadata: metaAssistant,
        media_bucket: null,
        media_storage_path: null,
        media_mime: null,
        media_duration_ms: null,
        media_public_url: null,
      })
      .select("id")
      .single();

    if (aErr || !asstIns) {
      return NextResponse.json({ error: "insertion_message_assistant" }, { status: 500 });
    }

    await admin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", body.conversationId);

    let balanceAfter = balance;
    let billingSkipped = billingExempt;

    if (creditCost > 0) {
      const reason =
        body.mode === "text"
          ? "chat_text"
          : body.mode === "image"
            ? "chat_image"
            : "chat_voice";
      const { data: debit, error: dErr } = await admin.rpc("consume_credits_atomic", {
        p_user_id: user.id,
        p_amount: creditCost,
        p_reason: reason,
        p_ref_type: "message",
        p_ref_id: asstIns.id as string,
      });

      const debitObj = debit as {
        ok?: boolean;
        balance_after?: number;
        billing_skipped?: boolean;
      } | null;
      if (dErr || !debitObj || debitObj.ok !== true) {
        return NextResponse.json(
          {
            error: "debit_credits_echoue",
            detail: debitObj ?? dErr?.message,
            messages_saved: true,
          },
          { status: 500 },
        );
      }
      billingSkipped = Boolean(debitObj.billing_skipped);
      if (typeof debitObj.balance_after === "number") {
        balanceAfter = debitObj.balance_after;
      }
    }

    const creditsDebited = billingSkipped ? 0 : creditCost;

    return NextResponse.json({
      ok: true,
      assistantMessageId: asstIns.id,
      userMessageId: userIns.id,
      reply: assistantText,
      credits_charged: creditsDebited,
      credit_cost: creditCost,
      balance_after: balanceAfter,
      billing_skipped: billingSkipped,
    });
  } catch (e) {
    console.error("[api/ai/chat]", e);
    return NextResponse.json(
      { error: "erreur_ia", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
