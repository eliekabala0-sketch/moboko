import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const envPath = join(root, "apps", "web", ".env.local");
const defaultDir =
  process.platform === "win32"
    ? join("C:", "Users", "user", "Downloads", "fichiers", "SERMONS", "CLEAN")
    : join(root, "data", "sermons-clean");

function loadEnv() {
  const env = { ...process.env };
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} manquant`);
  return value;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function loose(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function sha(value) {
  return createHash("sha256").update(normalizeText(value), "utf8").digest("hex");
}

function parseSource(fullPath, sourceFile) {
  const raw = readFileSync(fullPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const firstParaIdx = lines.findIndex((line) => /^\s*\[\d+\]\s*/.test(line));
  const paragraphs = [];
  let currentNum = null;
  let currentBuf = [];
  const flush = () => {
    if (currentNum == null) return;
    const text = normalizeText(currentBuf.join("\n"));
    if (text) paragraphs.push({ paragraph_number: currentNum, text, loose: loose(text), sha: sha(text) });
    currentBuf = [];
  };
  for (const line of firstParaIdx === -1 ? [] : lines.slice(firstParaIdx)) {
    const match = line.match(/^\s*\[(\d+)\]\s*(.*)$/);
    if (match) {
      flush();
      currentNum = Number(match[1]);
      currentBuf.push(match[2] ?? "");
    } else if (currentNum != null) {
      currentBuf.push(line);
    }
  }
  flush();
  return { sourceFile, paragraphs };
}

function duplicates(paragraphs) {
  const counts = new Map();
  for (const p of paragraphs) counts.set(p.paragraph_number, (counts.get(p.paragraph_number) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([number, count]) => ({ number, count }));
}

function jumps(paragraphs) {
  const out = [];
  for (let i = 1; i < paragraphs.length; i += 1) {
    const a = paragraphs[i - 1].paragraph_number;
    const b = paragraphs[i].paragraph_number;
    if (b !== a + 1) out.push({ from: a, to: b });
    if (out.length >= 10) break;
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(label, fn, attempts = 5) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const result = await fn();
      if (!result.error) return result;
      last = result.error;
    } catch (error) {
      last = error;
    }
    if (i + 1 < attempts) await sleep(Math.min(1000 * 2 ** i, 10000));
  }
  throw new Error(`${label}: ${last?.message ?? String(last)}`);
}

async function fetchParagraphs(supabase, sermonId) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data } = await retry(`paragraphs ${sermonId} ${from}`, () =>
      supabase
        .from("sermon_paragraphs")
        .select("paragraph_number, paragraph_text")
        .eq("sermon_id", sermonId)
        .order("paragraph_number", { ascending: true })
        .range(from, from + 499),
    );
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

function compare(source, sermon, dbRows) {
  const db = dbRows.map((p) => ({
    paragraph_number: Number(p.paragraph_number),
    text: normalizeText(p.paragraph_text),
    loose: loose(p.paragraph_text),
    sha: sha(p.paragraph_text),
  }));
  const byNumber = new Map(db.map((p) => [p.paragraph_number, p]));
  let exact = 0;
  let looseMatches = 0;
  let truncated = 0;
  const issues = [];
  for (const sp of source.paragraphs) {
    const dp = byNumber.get(sp.paragraph_number);
    if (!dp) {
      issues.push({ type: "missing_db_paragraph", number: sp.paragraph_number, sourceLength: sp.loose.length });
      continue;
    }
    if (dp.sha === sp.sha) {
      exact += 1;
      looseMatches += 1;
      continue;
    }
    if (dp.loose === sp.loose) {
      looseMatches += 1;
      continue;
    }
    const isTruncated = sp.loose.startsWith(dp.loose) && dp.loose.length < sp.loose.length;
    if (isTruncated) truncated += 1;
    issues.push({
      type: isTruncated ? "probable_truncated" : "text_mismatch",
      number: sp.paragraph_number,
      sourceLength: sp.loose.length,
      dbLength: dp.loose.length,
      sourceStart: sp.loose.slice(0, 160),
      dbStart: dp.loose.slice(0, 160),
      sourceTail: sp.loose.slice(-160),
      dbTail: dp.loose.slice(-160),
    });
  }
  return {
    source_file: source.sourceFile,
    sermon_id: sermon?.id ?? null,
    title: sermon?.title ?? null,
    sourceParagraphs: source.paragraphs.length,
    dbParagraphs: db.length,
    exact,
    looseMatches,
    truncated,
    sourceDuplicates: duplicates(source.paragraphs),
    dbDuplicates: duplicates(db),
    sourceJumps: jumps(source.paragraphs),
    dbJumps: jumps(db),
    issues,
  };
}

async function main() {
  const env = loadEnv();
  const dir = process.argv[2]?.trim() || env.MOBOKO_SERMON_CLEAN_DIR?.trim() || defaultDir;
  const supabase = createClient(required(env, "NEXT_PUBLIC_SUPABASE_URL"), required(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".txt")).sort((a, b) => a.localeCompare(b));
  const { data: sermons, error } = await retry("sermons", () =>
    supabase.from("sermons").select("id, source_file, title, paragraph_count").order("source_file", { ascending: true }).limit(5000),
  );
  if (error) throw error;
  const sermonBySource = new Map((sermons ?? []).map((s) => [s.source_file, s]));
  const comparisons = [];
  let processed = 0;
  for (const file of files) {
    const source = parseSource(join(dir, file), file);
    const sermon = sermonBySource.get(file);
    const dbRows = sermon ? await fetchParagraphs(supabase, sermon.id) : [];
    const comparison = compare(source, sermon, dbRows);
    comparisons.push(comparison);
    processed += 1;
    if (processed % 50 === 0) console.log(`progress=${processed}/${files.length}`);
  }
  const affected = comparisons.filter((c) => c.issues.length || c.sourceDuplicates.length || c.dbDuplicates.length);
  const report = {
    generatedAt: new Date().toISOString(),
    sourceDir: dir,
    sourceFiles: files.length,
    sermonsInDb: sermons?.length ?? 0,
    sourceParagraphs: comparisons.reduce((n, c) => n + c.sourceParagraphs, 0),
    dbParagraphs: comparisons.reduce((n, c) => n + c.dbParagraphs, 0),
    affectedSermons: affected.length,
    mismatchedParagraphs: comparisons.reduce((n, c) => n + c.issues.length, 0),
    probableTruncatedSermons: comparisons.filter((c) => c.truncated > 0).length,
    probableTruncatedParagraphs: comparisons.reduce((n, c) => n + c.truncated, 0),
    examples: affected.slice(0, 30).map((c) => ({
      source_file: c.source_file,
      title: c.title,
      sourceParagraphs: c.sourceParagraphs,
      dbParagraphs: c.dbParagraphs,
      exact: c.exact,
      looseMatches: c.looseMatches,
      truncated: c.truncated,
      sourceDuplicates: c.sourceDuplicates,
      dbDuplicates: c.dbDuplicates,
      sourceJumps: c.sourceJumps,
      dbJumps: c.dbJumps,
      issues: c.issues.slice(0, 5),
    })),
  };
  const outDir = join(root, "scripts", "sermons", "reports");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `sermon-integrity-stream-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  for (const [key, value] of Object.entries(report)) {
    if (key !== "examples") console.log(`${key}=${value}`);
  }
  console.log(`report=${outPath}`);
  for (const example of report.examples.slice(0, 10)) {
    console.log(`example=${example.source_file}|issues=${example.issues.length}|truncated=${example.truncated}|src=${example.sourceParagraphs}|db=${example.dbParagraphs}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
