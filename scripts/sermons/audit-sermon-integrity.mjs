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

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) args.set(key, "true");
  else {
    args.set(key, next);
    i += 1;
  }
}

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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

function normalizeLoose(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function checksum(value) {
  return createHash("sha256").update(normalizeText(value), "utf8").digest("hex");
}

function parseSourceFile(fullPath, sourceFile) {
  const raw = readFileSync(fullPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const firstParaIdx = lines.findIndex((line) => /^\s*\[\d+\]\s*/.test(line));
  const body = firstParaIdx === -1 ? "" : lines.slice(firstParaIdx).join("\n");
  const bodyLines = body.split(/\n/);
  const paragraphs = [];
  let currentNum = null;
  let currentBuf = [];
  const flush = () => {
    if (currentNum == null) return;
    const text = normalizeText(currentBuf.join("\n"));
    if (text) {
      paragraphs.push({
        paragraph_number: currentNum,
        paragraph_text: text,
        checksum: checksum(text),
        loose: normalizeLoose(text),
      });
    }
    currentBuf = [];
  };
  const marker = /^\s*\[(\d+)\]\s*(.*)$/;
  for (const line of bodyLines) {
    const match = line.match(marker);
    if (match) {
      flush();
      currentNum = Number(match[1]);
      currentBuf.push(match[2] ?? "");
    } else if (currentNum != null) {
      currentBuf.push(line);
    }
  }
  flush();
  return { source_file: sourceFile, paragraphs };
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await retry(`fetch ${from}-${to}`, () => queryFactory().range(from, to));
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(label, fn, attempts = 5) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await fn();
      if (!result?.error) return result;
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await sleep(Math.min(1000 * 2 ** attempt, 10000));
  }
  throw new Error(`${label}: ${lastError?.message ?? String(lastError)}`);
}

function duplicateNumbers(paragraphs) {
  const counts = new Map();
  for (const p of paragraphs) counts.set(p.paragraph_number, (counts.get(p.paragraph_number) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([number, count]) => ({ number, count }));
}

function abnormalJumps(paragraphs) {
  const jumps = [];
  for (let i = 1; i < paragraphs.length; i += 1) {
    const prev = paragraphs[i - 1].paragraph_number;
    const next = paragraphs[i].paragraph_number;
    if (Number.isFinite(prev) && Number.isFinite(next) && next !== prev + 1) {
      jumps.push({ from: prev, to: next });
      if (jumps.length >= 10) break;
    }
  }
  return jumps;
}

function compareSermon(source, sermon, dbParagraphs) {
  const byNumber = new Map();
  for (const p of dbParagraphs) {
    const arr = byNumber.get(p.paragraph_number) ?? [];
    arr.push({
      paragraph_number: p.paragraph_number,
      paragraph_text: normalizeText(p.paragraph_text),
      checksum: checksum(p.paragraph_text),
      loose: normalizeLoose(p.paragraph_text),
    });
    byNumber.set(p.paragraph_number, arr);
  }

  const issues = [];
  let exactMatches = 0;
  let looseMatches = 0;
  let truncated = 0;
  for (const sp of source.paragraphs) {
    const matches = byNumber.get(sp.paragraph_number) ?? [];
    if (matches.length === 0) {
      issues.push({ type: "missing_db_paragraph", number: sp.paragraph_number, sourceLength: sp.loose.length });
      continue;
    }
    const db = matches[0];
    if (db.checksum === sp.checksum) {
      exactMatches += 1;
      looseMatches += 1;
      continue;
    }
    if (db.loose === sp.loose) {
      looseMatches += 1;
      continue;
    }
    const sourceContainsDbPrefix = sp.loose.startsWith(db.loose) && db.loose.length < sp.loose.length;
    if (sourceContainsDbPrefix) truncated += 1;
    issues.push({
      type: sourceContainsDbPrefix ? "probable_truncated" : "text_mismatch",
      number: sp.paragraph_number,
      sourceLength: sp.loose.length,
      dbLength: db.loose.length,
      sourceStart: sp.loose.slice(0, 180),
      dbStart: db.loose.slice(0, 180),
      sourceTail: sp.loose.slice(-180),
      dbTail: db.loose.slice(-180),
    });
  }

  return {
    source_file: source.source_file,
    sermon_id: sermon?.id ?? null,
    title: sermon?.title ?? null,
    sourceParagraphs: source.paragraphs.length,
    dbParagraphs: dbParagraphs.length,
    exactMatches,
    looseMatches,
    truncated,
    sourceDuplicates: duplicateNumbers(source.paragraphs),
    dbDuplicates: duplicateNumbers(dbParagraphs),
    sourceJumps: abnormalJumps(source.paragraphs),
    dbJumps: abnormalJumps(dbParagraphs),
    issues,
  };
}

async function main() {
  const env = loadEnv();
  const dir = args.get("dir") || env.MOBOKO_SERMON_CLEAN_DIR?.trim() || defaultDir;
  if (!existsSync(dir)) throw new Error(`Dossier source introuvable: ${dir}`);
  const supabase = createClient(required(env, "NEXT_PUBLIC_SUPABASE_URL"), required(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const files = readdirSync(dir).filter((file) => file.toLowerCase().endsWith(".txt")).sort((a, b) => a.localeCompare(b));
  const sources = files.map((file) => parseSourceFile(join(dir, file), file));
  const sermons = await fetchAll(
    () => supabase.from("sermons").select("id, source_file, title, paragraph_count").order("source_file", { ascending: true }),
    500,
  );
  const sermonBySource = new Map(sermons.map((sermon) => [sermon.source_file, sermon]));
  const sermonIds = new Set(sermons.map((sermon) => sermon.id));
  const paragraphs = await fetchAll(
    () =>
      supabase
        .from("sermon_paragraphs")
        .select("sermon_id, paragraph_number, paragraph_text")
        .order("sermon_id", { ascending: true })
        .order("paragraph_number", { ascending: true }),
    250,
  );
  const paragraphsBySermon = new Map();
  for (const p of paragraphs) {
    if (!sermonIds.has(p.sermon_id)) continue;
    const arr = paragraphsBySermon.get(p.sermon_id) ?? [];
    arr.push(p);
    paragraphsBySermon.set(p.sermon_id, arr);
  }

  const comparisons = sources.map((source) => {
    const sermon = sermonBySource.get(source.source_file) ?? null;
    return compareSermon(source, sermon, sermon ? paragraphsBySermon.get(sermon.id) ?? [] : []);
  });

  const affected = comparisons.filter((c) => c.issues.length || c.sourceDuplicates.length || c.dbDuplicates.length);
  const truncated = comparisons.filter((c) => c.truncated > 0);
  const sourceParagraphs = comparisons.reduce((sum, c) => sum + c.sourceParagraphs, 0);
  const dbParagraphs = comparisons.reduce((sum, c) => sum + c.dbParagraphs, 0);
  const mismatchedParagraphs = comparisons.reduce((sum, c) => sum + c.issues.length, 0);
  const truncatedParagraphs = comparisons.reduce((sum, c) => sum + c.truncated, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    sourceDir: dir,
    sourceFiles: files.length,
    sermonsInDb: sermons.length,
    sourceParagraphs,
    dbParagraphs,
    affectedSermons: affected.length,
    mismatchedParagraphs,
    probableTruncatedSermons: truncated.length,
    probableTruncatedParagraphs: truncatedParagraphs,
    examples: affected.slice(0, 25).map((c) => ({
      source_file: c.source_file,
      title: c.title,
      sourceParagraphs: c.sourceParagraphs,
      dbParagraphs: c.dbParagraphs,
      exactMatches: c.exactMatches,
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
  const outPath = join(outDir, `sermon-integrity-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`source_files=${report.sourceFiles}`);
  console.log(`sermons_db=${report.sermonsInDb}`);
  console.log(`source_paragraphs=${report.sourceParagraphs}`);
  console.log(`db_paragraphs=${report.dbParagraphs}`);
  console.log(`affected_sermons=${report.affectedSermons}`);
  console.log(`mismatched_paragraphs=${report.mismatchedParagraphs}`);
  console.log(`probable_truncated_sermons=${report.probableTruncatedSermons}`);
  console.log(`probable_truncated_paragraphs=${report.probableTruncatedParagraphs}`);
  console.log(`report=${outPath}`);
  for (const example of report.examples.slice(0, 10)) {
    console.log(`example=${example.source_file}|issues=${example.issues.length}|truncated=${example.truncated}|src=${example.sourceParagraphs}|db=${example.dbParagraphs}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
