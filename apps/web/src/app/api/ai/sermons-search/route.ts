import {
  clipForPrompt,
  fetchSermonSearchCandidates,
  type SermonParagraphCandidate,
} from "@/lib/sermons/ai-sermon-search-server";
import { getOpenAIClient, runStructuredJsonCompletion } from "@/lib/ai/moboko-chat";
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
export const maxDuration = 90;

type Body = { query?: string };
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

function parseBody(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const q = (raw as Body).query;
  if (typeof q !== "string") return null;
  const t = q.trim();
  if (t.length < 8 || t.length > 2000) return null;
  return t;
}

type AiPick = { i?: number; note?: string };

function parseAiPicks(raw: string, n: number): { picks: AiPick[]; summary: string | null } | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, 500) : null;
  const arr = o.picks;
  if (arr === undefined) {
    return { picks: [], summary };
  }
  if (!Array.isArray(arr)) return null;
  const picks: AiPick[] = [];
  const used = new Set<number>();
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    const i = typeof p.i === "number" && Number.isInteger(p.i) ? p.i : null;
    if (i === null || i < 1 || i > n || used.has(i)) continue;
    used.add(i);
    const note =
      typeof p.note === "string" ? p.note.trim().slice(0, 220) : undefined;
    picks.push({ i, note });
    if (picks.length >= 8) break;
  }
  return { picks, summary };
}

function buildRankingPrompt(query: string, candidates: SermonParagraphCandidate[]): string {
  const lines = candidates.map((c, idx) => {
    const y = c.year != null ? String(c.year) : "";
    const clip = clipForPrompt(c.paragraph_text);
    return `${idx + 1}\t${c.slug}\t${c.title.replace(/\s+/g, " ").trim()}\t${y}\t${c.paragraph_number}\t${clip}`;
  });
  return [
    `Question de l'utilisateur (français) :`,
    query,
    "",
    "Extraits numérotés (TSV : n° | slug | titre | année | n° paragraphe | extrait). Tu ne peux citer que ces numéros.",
    lines.join("\n"),
  ].join("\n");
}

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

async function extractSemanticIntent(
  openai: NonNullable<ReturnType<typeof getOpenAIClient>>,
  query: string,
): Promise<SemanticIntent | null> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `Analyse une requête utilisateur en français pour rechercher des passages de sermons.
Retourne UNIQUEMENT un JSON:
{"search_mode":"...","user_need":"...","intent":"...","topic":"...","concepts":["..."],"expansions":["..."],"content_types":["..."],"quoted_phrase":"...|null","sermon_hint":"...|null","year_from":1963|null,"year_to":1965|null,"maybe_meant":"...|null"}
Règles:
- search_mode parmi: exact_quote_search, theme_search, situation_search, story_search, prayer_search, doctrinal_search, time_bounded_search, preaching_prep_search, comfort_or_exhortation_search, sermon_title_then_topic_search.
- user_need parmi: simple_answer, orientation, exhortation, comfort, preaching_prep, citation_list, prayer_list, story_list.
- intent: reformulation courte de ce que la personne veut vraiment.
- topic: thème principal (court).
- concepts: notions sémantiques proches (pas de bruit lexical), max 10.
- expansions: reformulations utiles pour interroger une base textuelle, max 8.
- content_types: types de passages visés (ex: prayer, prayer_line, story, testimony, citation, exhortation).
- quoted_phrase: phrase la plus proche d'une déclaration recherchée, sinon null.
- sermon_hint: titre de sermon probable si l'utilisateur en cite un, sinon null.
- year_from/year_to: bornes temporelles si demandées, sinon null.
- maybe_meant: précision utile si ambiguïté, sinon null.
- tolérance forte aux fautes d’orthographe, fautes de frappe, accents manquants, phrases incomplètes et mots-clés isolés.
- relier les formulations approximatives à l’idée probable (ex: "prophete" => "prophète", "dime" => "dîme", "q dit le prophete sur boire" => alcool/vin/sobriété/tempérance).
- Ne pas inventer de citation ni de référence.`,
    },
    { role: "user", content: query },
  ];
  const raw = await runStructuredJsonCompletion(openai, messages, {
    maxTokens: 450,
    temperature: 0.1,
  });
  if (!raw) return null;
  return parseSemanticIntent(raw);
}

async function fetchSemanticCandidates(
  admin: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  query: string,
  sem: SemanticIntent | null,
) {
  const typeExpansions =
    sem?.search_mode === "prayer_search"
      ? ["prière", "prions", "je prie", "prayer line", "ligne de prière"]
      : sem?.search_mode === "story_search"
        ? ["histoire", "récit", "témoignage", "il raconta", "il dit"]
        : sem?.search_mode === "comfort_or_exhortation_search"
          ? ["consolation", "réconfort", "fortifie", "encouragement", "espérance"]
          : [];
  const quoted = sem?.quoted_phrase ? [sem.quoted_phrase] : [];
  const titleThenTopic =
    sem?.search_mode === "sermon_title_then_topic_search" && sem?.sermon_hint
      ? [`${sem.sermon_hint} ${sem.topic || query}`]
      : [];
  const queries = [
    query,
    sem?.intent ?? "",
    sem?.topic ?? "",
    ...quoted,
    ...titleThenTopic,
    ...(sem?.expansions ?? []),
    ...(sem?.concepts ?? []),
    ...typeExpansions,
  ]
    .map((x) => x.trim())
    .filter((x, i, arr) => x.length >= 3 && arr.indexOf(x) === i)
    .slice(0, 18);

  const byKey = new Map<string, SermonParagraphCandidate>();
  const collect = async (q: string) => {
    const rows = await fetchSermonSearchCandidates(admin, q);
    for (const c of rows) {
      const k = `${c.slug}:${c.paragraph_number}`;
      if (!byKey.has(k)) byKey.set(k, c);
      if (byKey.size >= 520) break;
    }
  };

  // Wave A: principal + intent.
  for (const q of queries.slice(0, 4)) {
    await collect(q);
    if (byKey.size >= 260) break;
  }
  // Wave B: concepts/expansions.
  if (byKey.size < 260) {
    for (const q of queries.slice(4, 12)) {
      await collect(q);
      if (byKey.size >= 380) break;
    }
  }
  // Wave C: fallback large.
  if (byKey.size < 220) {
    const broad = [sem?.topic ?? "", ...(sem?.concepts ?? []).slice(0, 4)]
      .filter(Boolean)
      .join(" ");
    if (broad.trim().length >= 3) {
      await collect(broad);
    }
    for (const q of queries.slice(12)) {
      await collect(q);
      if (byKey.size >= 500) break;
    }
  }
  let out = Array.from(byKey.values());
  if (sem?.year_from != null || sem?.year_to != null) {
    const minY = sem.year_from ?? 1900;
    const maxY = sem.year_to ?? 2100;
    out = out.filter((c) => c.year == null || (c.year >= minY && c.year <= maxY));
  }

  const hasType = (txt: string, needles: string[]) =>
    needles.some((n) => txt.includes(n));
  const score = (c: SermonParagraphCandidate) => {
    const t = c.paragraph_text.toLowerCase();
    let s = 0;
    if (sem?.search_mode === "exact_quote_search" && sem.quoted_phrase) {
      if (t.includes(sem.quoted_phrase.toLowerCase())) s += 12;
    }
    if (sem?.search_mode === "prayer_search" || sem?.content_types.includes("prayer")) {
      if (hasType(t, ["prions", "prière", "je prie", "amen"])) s += 6;
    }
    if (sem?.search_mode === "story_search" || sem?.content_types.includes("story")) {
      if (hasType(t, ["histoire", "récit", "témoign", "il dit", "il raconta"])) s += 5;
    }
    if (sem?.search_mode === "comfort_or_exhortation_search") {
      if (hasType(t, ["consol", "réconfort", "fortifie", "espérance"])) s += 4;
    }
    if (sem?.topic && t.includes(sem.topic.toLowerCase())) s += 3;
    return s;
  };
  out.sort((a, b) => score(b) - score(a));
  return out.slice(0, 500);
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

  let query: string;
  try {
    const json = (await request.json()) as unknown;
    const p = parseBody(json);
    if (!p) {
      return NextResponse.json(
        { error: "requete_invalide", detail: "Texte entre 8 et 2000 caractères requis." },
        { status: 400 },
      );
    }
    query = p;
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
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

  const aiEnabled = Boolean(settings[PUBLIC_APP_SETTING_KEYS.sermonAiSearchEnabled]);
  if (!aiEnabled) {
    return NextResponse.json({ error: "sermon_ia_desactive" }, { status: 403 });
  }

  const creditCost = Math.max(
    0,
    Math.floor(Number(settings[PUBLIC_APP_SETTING_KEYS.sermonAiSearchCreditCost] ?? 2)),
  );

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
      summary: null,
      credits_charged: 0,
      credit_cost: creditCost,
      balance_after: balance,
      billing_skipped: billingExempt,
      hint:
        "Aucun passage pertinent trouvé pour cette formulation. Essayez une reformulation plus précise (thème, titre de sermon, idée clé).",
    });
  }

  if (!billingExempt && creditCost > 0 && balance < creditCost) {
    return NextResponse.json(
      {
        error: "credits_insuffisants",
        message: `Il vous faut ${creditCost} crédit(s) pour la recherche IA (solde : ${balance}).`,
        balance,
        required: creditCost,
      },
      { status: 402 },
    );
  }

  const userPrompt = buildRankingPrompt(query, candidates);
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `Tu es un assistant de recherche pour une bibliothèque de sermons chrétiens en français.
On te donne une question en langage naturel et une liste d'extraits numérotés (déjà issus de la base).
Ta tâche : choisir les extraits qui répondent le mieux à la question (sens, thème, formulation), y compris les reformulations et les questions implicites.
Tu ne dois JAMAIS inventer de sermon, de titre ou de numéro de paragraphe : uniquement des numéros "i" présents dans la liste (1 à N).
Réponds en JSON strict avec le schéma :
{"summary":"une phrase courte sur ce que tu as retenu (ou chaîne vide)","picks":[{"i":1,"note":"pourquoi ce passage répond (court)"}]}
Maximum 8 entrées dans picks, les plus pertinentes en premier. Si rien ne convient, picks [].`,
    },
    {
      role: "user",
      content:
        `${userPrompt}\n\n` +
        `Contexte sémantique déduit:\n` +
        `- intent: ${semantic?.intent || "(non déterminé)"}\n` +
        `- concepts: ${(semantic?.concepts ?? []).join(", ") || "(aucun)"}\n` +
        `- maybe_meant: ${semantic?.maybe_meant || "(aucun)"}\n`,
    },
  ];

  let rawJson: string;
  try {
    rawJson = await runStructuredJsonCompletion(openai, messages, {
      maxTokens: 1400,
      temperature: 0.2,
    });
  } catch (e) {
    console.error("[api/ai/sermons-search] completion", e);
    return NextResponse.json(
      { error: "erreur_ia", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  if (!rawJson) {
    return NextResponse.json({ error: "reponse_ia_vide" }, { status: 502 });
  }

  const parsed = parseAiPicks(rawJson, candidates.length);
  if (parsed === null) {
    return NextResponse.json(
      { error: "reponse_ia_invalide", detail: "Le classement IA n’a pas pu être interprété." },
      { status: 502 },
    );
  }

  const { picks, summary } = parsed;

  const results = picks
    .filter((pick): pick is { i: number; note?: string } => typeof pick.i === "number")
    .map((pick) => {
    const c = candidates[pick.i - 1];
    if (!c) {
      return null;
    }
    const slugEnc = encodeURIComponent(c.slug);
    return {
      slug: c.slug,
      title: c.title,
      year: c.year,
      preached_on: c.preached_on,
      location: c.location,
      paragraph_number: c.paragraph_number,
      paragraph_text: c.paragraph_text,
      read_href: `/sermons/${slugEnc}#p-${c.paragraph_number}`,
      project_href: `/sermons/${slugEnc}/project?p=${c.paragraph_number}`,
      note: pick.note?.trim() || null,
    };
  })
    .filter((r): r is NonNullable<typeof r> => r != null);

  let balanceAfter = balance;
  let billingSkipped = billingExempt;
  let creditsDebited = 0;

  if (creditCost > 0) {
    const { data: debit, error: dErr } = await admin.rpc("consume_credits_atomic", {
      p_user_id: user.id,
      p_amount: creditCost,
      p_reason: "sermon_ai_search",
      p_ref_type: "sermon_ai_search",
      p_ref_id: null,
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
        },
        { status: 500 },
      );
    }
    billingSkipped = Boolean(debitObj.billing_skipped);
    if (typeof debitObj.balance_after === "number") {
      balanceAfter = debitObj.balance_after;
    }
    creditsDebited = billingSkipped ? 0 : creditCost;
  }

  return NextResponse.json({
    ok: true,
    results,
    summary,
    semantic,
    credits_charged: creditsDebited,
    credit_cost: creditCost,
    balance_after: balanceAfter,
    billing_skipped: billingSkipped,
  });
}
