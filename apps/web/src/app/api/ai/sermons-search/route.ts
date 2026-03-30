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

function parseBody(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const q = (raw as Body).query;
  if (typeof q !== "string") return null;
  const t = q.trim();
  if (t.length < 8 || t.length > 2000) return null;
  return t;
}

function excerptDisplay(text: string, max = 340) {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
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

  const candidates = await fetchSermonSearchCandidates(admin, query);

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      results: [],
      summary: null,
      credits_charged: 0,
      credit_cost: creditCost,
      balance_after: balance,
      billing_skipped: billingExempt,
      hint: "Aucun passage pertinent trouvé dans l’index (essayez des mots du texte ou le titre du sermon).",
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
    { role: "user", content: userPrompt },
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
      paragraph_number: c.paragraph_number,
      excerpt: excerptDisplay(c.paragraph_text),
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
    credits_charged: creditsDebited,
    credit_cost: creditCost,
    balance_after: balanceAfter,
    billing_skipped: billingSkipped,
  });
}
