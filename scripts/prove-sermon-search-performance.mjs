/**
 * Production performance proof for Moboko sermon search.
 *
 * Measures:
 * - normal search engine latency through the production Supabase RPC
 * - assisted search latency through the production Next API
 * - OpenAI call count, candidates, rehydrated paragraphs, and ranking tiers
 *
 * Secrets are read from apps/web/.env.local and never printed.
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { Agent } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const webEnvPath = join(root, "apps", "web", ".env.local");
const PROD_URL = process.argv[2]?.trim() || "https://moboko-production.up.railway.app";

const NORMAL_QUERIES = [
  "la foi comme pieds de l'eglise",
  "femme a la perte de sang",
  "Apocalypse 10",
  "sept tonnerres",
];

const AI_QUERIES = [
  "declarations du prophete en 1965 sur les sept tonnerres",
  "ou le prophete explique comment la femme doit accueillir son mari en rentrant a la maison",
  "dans La Breche, ou parle-t-il d'Apocalypse 10",
  "femme a la perte de sang dans La Stature d'un homme parfait",
];

const agent = new Agent({
  connectTimeout: 20_000,
  headersTimeout: 140_000,
  bodyTimeout: 140_000,
});

function loadWebEnvLocal() {
  if (!existsSync(webEnvPath)) throw new Error(`Missing ${webEnvPath}`);
  const env = {};
  for (const line of readFileSync(webEnvPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

function tierLabel(tier) {
  if (tier === 0) return "paragraph_number";
  if (tier === 1) return "exact_phrase";
  if (tier === 2) return "word_group_fts";
  if (tier === 3) return "important_words";
  if (tier === 4) return "near_expression_trigram";
  return "unknown";
}

async function timed(label, fn) {
  const t0 = performance.now();
  const out = await fn();
  const ms = Math.round(performance.now() - t0);
  return { label, ms, out };
}

async function main() {
  const env = loadWebEnvLocal();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim();
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim();
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !anon || !service) {
    throw new Error("Supabase URL, anon key, or service role key missing in apps/web/.env.local");
  }

  const admin = createClient(supabaseUrl, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Moboko sermon search performance ===");
  console.log("production:", PROD_URL);
  console.log("");

  const normalRuns = [];
  for (const query of NORMAL_QUERIES) {
    const run = await timed(query, async () => {
      const { data, error } = await admin.rpc("moboko_search_sermon_paragraphs", {
        p_query: query,
        p_queries: null,
        p_sermon_slug: null,
        p_title_filter: null,
        p_year: null,
        p_location_filter: null,
        p_limit: 20,
        p_offset: 0,
      });
      if (error) throw error;
      return data ?? [];
    });
    normalRuns.push(run);
  }

  console.log("--- Normal search RPC ---");
  for (const run of normalRuns) {
    const rows = run.out;
    const tiers = new Map();
    for (const r of rows) tiers.set(r.relevance_tier, (tiers.get(r.relevance_tier) ?? 0) + 1);
    const tierSummary = [...tiers.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tier, count]) => `${tierLabel(tier)}=${count}`)
      .join(", ");
    const first = rows[0];
    console.log(
      `${run.ms}ms | "${run.label}" | rows=${rows.length} | total=${first?.total_count ?? rows.length} | tiers=${tierSummary || "none"} | first=${first?.slug ?? "-"} #${first?.paragraph_number ?? "-"}`,
    );
  }
  console.log(
    `normal avg=${Math.round(avg(normalRuns.map((r) => r.ms)))}ms p95=${percentile(normalRuns.map((r) => r.ms), 95)}ms`,
  );
  console.log("");

  const email = `moboko.perf.${Date.now()}@example.com`;
  const password = "MobokoPerf!temp8721";
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error("createUser failed");
  const userId = created.user.id;

  try {
    await admin
      .from("profiles")
      .update({ credit_balance: 9999, is_free_access: false })
      .eq("id", userId);

    const userClient = createClient(supabaseUrl, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sessionData, error: signInErr } = await userClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !sessionData.session) throw signInErr ?? new Error("signIn failed");
    const token = sessionData.session.access_token;

    const aiRuns = [];
    for (const query of AI_QUERIES) {
      const run = await timed(query, async () => {
        const res = await fetch(`${PROD_URL.replace(/\/$/, "")}/api/ai/sermons-search`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "x-moboko-diagnostics": "1",
          },
          body: JSON.stringify({ query, pageSize: 20 }),
          dispatcher: agent,
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json };
      });
      aiRuns.push(run);
    }

    console.log("--- Assisted search production API ---");
    for (const run of aiRuns) {
      const { status, json } = run.out;
      const d = json.diagnostics ?? {};
      console.log(
        `${run.ms}ms | "${run.label}" | http=${status} | ok=${json.ok === true} | openai_calls=${d.openai_calls ?? "n/a"} | candidates=${d.candidate_count ?? "n/a"} | rehydrated=${d.rehydrated_count ?? json.results?.length ?? "n/a"} | intent=${d.intent_mode ?? "n/a"} | route=${d.retrieval_route ?? "n/a"} | fast_rpc=${d.used_fast_search_rpc ?? "n/a"} | credits=${json.credits_charged ?? "n/a"}`,
      );
      const first = Array.isArray(json.results) ? json.results[0] : null;
      console.log(`  first=${first?.slug ?? "-"} #${first?.paragraph_number ?? "-"} total=${json.total_count ?? "-"}`);
      if (json.message) console.log(`  message=${json.message}`);
    }
    console.log(
      `assistant avg=${Math.round(avg(aiRuns.map((r) => r.ms)))}ms p95=${percentile(aiRuns.map((r) => r.ms), 95)}ms`,
    );
  } finally {
    await admin.auth.admin.deleteUser(userId);
    console.log("");
    console.log("temporary test user deleted");
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
