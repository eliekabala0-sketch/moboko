import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const SOURCE_DIR = "C:/Users/user/Downloads/cantique";
const OUT_DIR = path.resolve("data/import-ready");
const ENV_FILE = path.resolve("apps/web/.env.local");

const BOOKS = [
  { match: /crois seulement/i, slug: "crois-seulement", pdf: /crois seulement/i },
  { match: /hosana|hosanna/i, slug: "hosanna", pdf: /hosana|hosanna/i },
  { match: /pene na yo/i, slug: "pene-na-yo", pdf: /pene na yo/i },
];

const MARKER_RE = /^(refrain|choeur|chœur|chorus|r\.|c\.)\s*:?\s*/i;
const HYMN_START_RE = /^(?:n[°o.]?|no|numero|numéro|cantique)?\s*(\d{1,4})\s*[.)-]\s+(.+)$/i;

function readEnv(file) {
  const out = {};
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/g)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return out;
}

function cleanLine(line) {
  return line.replace(/\t/g, " ").replace(/\s{2,}/g, " ").trim();
}

function median(numbers) {
  const values = numbers.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (values.length === 0) return 0;
  return values[Math.floor(values.length / 2)] ?? 0;
}

function normalizeComparable(text) {
  return cleanLine(text).replace(/\s+/g, " ").trim();
}

function isNoiseLine(text) {
  return (
    /^\d{1,4}$/.test(text) ||
    /^--\s*\d+\s+of\s+\d+\s*--$/i.test(text) ||
    /^index$/i.test(text)
  );
}

async function extractPositionedLines(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdf = await getDocument({ data, disableWorker: true }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent({ disableCombineTextItems: false });
    const buckets = [];
    for (const item of text.items ?? []) {
      const raw = typeof item.str === "string" ? item.str : "";
      if (!raw.trim()) continue;
      const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
      const x = Number(transform[4] ?? 0);
      const y = Number(transform[5] ?? 0);
      const height = Number(item.height ?? Math.abs(transform[3] ?? 0) ?? 0);
      let bucket = buckets.find((row) => Math.abs(row.y - y) <= Math.max(1.8, height * 0.35));
      if (!bucket) {
        bucket = { page: pageNumber, y, height, parts: [] };
        buckets.push(bucket);
      }
      const width = Number(item.width ?? 0);
      bucket.parts.push({ x, width, text: raw });
      bucket.y = (bucket.y + y) / 2;
      bucket.height = Math.max(bucket.height, height);
    }
    const pageLines = [];
    buckets.forEach((row) => {
      const parts = row.parts.sort((a, b) => a.x - b.x);
      const clusters = [];
      let current = [];
      for (const part of parts) {
        const prev = current.at(-1);
        const gap = prev ? part.x - (prev.x + Math.max(prev.width, 4)) : 0;
        if (prev && gap > 42) {
          clusters.push(current);
          current = [];
        }
        current.push(part);
      }
      if (current.length) clusters.push(current);
      for (const cluster of clusters) {
        const value = cleanLine(cluster.map((part) => part.text).join(" "));
        if (!value || isNoiseLine(value)) continue;
        pageLines.push({
          page: row.page,
          x: cluster[0]?.x ?? 0,
          y: row.y,
          height: row.height,
          text: value,
        });
      }
    });
    const columnBreaks = [...pageLines]
      .sort((a, b) => a.x - b.x)
      .reduce((cols, line) => {
        const col = cols.find((item) => Math.abs(item.x - line.x) < 80);
        if (col) {
          col.x = (col.x + line.x) / 2;
          col.lines.push(line);
        } else {
          cols.push({ x: line.x, lines: [line] });
        }
        return cols;
      }, []);
    columnBreaks
      .sort((a, b) => a.x - b.x)
      .forEach((col) => {
        col.lines.sort((a, b) => b.y - a.y).forEach((line) => lines.push(line));
      });
  }
  return lines;
}

function findStarts(lines) {
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].text.match(HYMN_START_RE);
    if (!match) continue;
    const number = Number(match[1]);
    const title = cleanLine(match[2] ?? "");
    const letters = title.match(/[A-Za-zÀ-ÿ]/g) ?? [];
    const uppercase = title.match(/[A-ZÀ-Ý]/g) ?? [];
    const uppercaseRatio = letters.length ? uppercase.length / letters.length : 0;
    const looksLikeTitle = uppercaseRatio >= 0.68 || /^[A-ZÀ-Ý0-9'’ ,.!?;:-]+$/.test(title);
    if (number > 0 && title.length >= 2 && looksLikeTitle) starts.push({ index, number, title });
  }
  return starts;
}

function splitBlocks(lines) {
  if (lines.length === 0) return [];
  const gaps = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i - 1].page !== lines[i].page) continue;
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  const normalGap = median(gaps) || median(lines.map((line) => line.height)) || 10;
  const threshold = Math.max(normalGap * 1.45, normalGap + 3.2);
  const blocks = [];
  let current = [lines[0]];
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1];
    const next = lines[i];
    const gap = prev.page === next.page ? prev.y - next.y : Infinity;
    const markerBoundary = MARKER_RE.test(next.text);
    if (gap > threshold || markerBoundary || prev.page !== next.page) {
      blocks.push(current);
      current = [];
    }
    current.push(next);
  }
  if (current.length) blocks.push(current);
  return blocks.map((block) => block.map((line) => line.text));
}

function stripMarker(line) {
  return cleanLine(line.replace(MARKER_RE, ""));
}

function structureFromBlocks(blocks) {
  const verses = [];
  const notes = [];
  let chorus = null;
  let expectingChorus = false;

  for (const rawBlock of blocks) {
    const block = rawBlock.map(cleanLine).filter(Boolean);
    if (block.length === 0) continue;
    const first = block[0] ?? "";
    const marker = first.match(MARKER_RE);
    if (marker) {
      const firstText = stripMarker(first);
      const text = [firstText, ...block.slice(1)].filter(Boolean).join("\n").trim();
      if (text) {
        chorus = chorus ? `${chorus}\n${text}` : text;
        expectingChorus = false;
      } else {
        expectingChorus = true;
      }
      continue;
    }
    const text = block.join("\n").trim();
    if (!text) continue;
    if (expectingChorus) {
      chorus = chorus ? `${chorus}\n${text}` : text;
      expectingChorus = false;
      continue;
    }
    verses.push({ number: verses.length + 1, text });
  }

  if (expectingChorus) notes.push("chorus_marker_without_text");
  if (verses.length === 0) notes.push("no_verse_detected");
  return { verses, chorus, notes };
}

function parseBookFromPdf(filePath, importedBook) {
  return extractPositionedLines(filePath).then((lines) => {
    const starts = findStarts(lines);
    const byNumber = new Map();
    const ambiguous = [];
    for (let i = 0; i < starts.length; i += 1) {
      const current = starts[i];
      const nextIndex = starts[i + 1]?.index ?? lines.length;
      let title = current.title;
      const body = lines.slice(current.index + 1, nextIndex);
      while (
        body.length > 0 &&
        title.length < 80 &&
        !MARKER_RE.test(body[0].text) &&
        /^[A-ZÀ-Ÿ0-9'’ ,.!?-]+$/.test(body[0].text)
      ) {
        title += ` ${body.shift().text}`;
      }
      const blocks = splitBlocks(body);
      const structured = structureFromBlocks(blocks);
      const imported = importedBook.hymns.find((hymn) => String(hymn.number) === String(current.number));
      const oldText = normalizeComparable(imported?.full_text ?? "");
      const newText = normalizeComparable([structured.verses.map((v) => v.text).join(" "), structured.chorus].filter(Boolean).join(" "));
      const containsImportedText = oldText.length > 0 && normalizeComparable((imported?.full_text ?? "").replace(MARKER_RE, "")).length > 0;
      if (!imported || structured.notes.length || structured.verses.length <= 1 || !containsImportedText) {
        ambiguous.push({
          number: current.number,
          title,
          notes: structured.notes,
          verses: structured.verses.length,
          has_chorus: Boolean(structured.chorus),
          text_length_delta: newText.length - oldText.length,
        });
      }
      byNumber.set(String(current.number), {
        number: String(current.number),
        title,
        verses: structured.verses,
        chorus: structured.chorus,
        validation_notes: structured.notes,
      });
    }
    return { starts: starts.length, byNumber, ambiguous };
  });
}

async function updateProduction(updates, dryRun) {
  if (dryRun) return { updated: 0 };
  const env = readEnv(ENV_FILE);
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let updated = 0;
  for (const item of updates) {
    const { error } = await supabase
      .from("hymns")
      .update({
        verses: item.verses,
        chorus: item.chorus,
        validation_status: item.validation_notes.length ? "needs_review" : "valid",
        validation_notes: item.validation_notes,
      })
      .eq("book_id", item.book_id)
      .eq("number", item.number);
    if (error) throw new Error(`${item.book_slug} ${item.number}: ${error.message}`);
    updated += 1;
  }
  return { updated };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const pdfFiles = fs.readdirSync(SOURCE_DIR).filter((file) => file.toLowerCase().endsWith(".pdf"));
  const env = readEnv(ENV_FILE);
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: books, error: booksError } = await supabase.from("hymn_books").select("id, slug, name").order("name");
  if (booksError) throw booksError;

  const report = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    analyzed: 0,
    updates: 0,
    with_chorus: 0,
    without_chorus: 0,
    ambiguous: [],
    raw_text_changed: 0,
    books: [],
  };
  const updates = [];

  for (const bookConfig of BOOKS) {
    const bookRow = books?.find((book) => book.slug === bookConfig.slug);
    if (!bookRow) continue;
    const pdfName = pdfFiles.find((file) => bookConfig.pdf.test(file));
    if (!pdfName) throw new Error(`PDF missing for ${bookConfig.slug}`);
    const jsonPath = path.join(OUT_DIR, `${bookConfig.slug}.json`);
    const imported = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const parsed = await parseBookFromPdf(path.join(SOURCE_DIR, pdfName), imported);
    let bookUpdates = 0;
    for (const hymn of imported.hymns) {
      const structured = parsed.byNumber.get(String(hymn.number));
      if (!structured) continue;
      report.analyzed += 1;
      if (structured.chorus) report.with_chorus += 1;
      else report.without_chorus += 1;
      const oldVerses = JSON.stringify(hymn.verses ?? []);
      const newVerses = JSON.stringify(structured.verses);
      const oldChorus = hymn.chorus ?? null;
      const newChorus = structured.chorus ?? null;
      if (oldVerses !== newVerses || oldChorus !== newChorus) {
        updates.push({
          book_id: bookRow.id,
          book_slug: bookConfig.slug,
          number: String(hymn.number),
          verses: structured.verses,
          chorus: newChorus,
          validation_notes: structured.validation_notes,
        });
        bookUpdates += 1;
      }
    }
    report.updates += bookUpdates;
    report.ambiguous.push(...parsed.ambiguous.map((item) => ({ book: bookConfig.slug, ...item })));
    report.books.push({
      slug: bookConfig.slug,
      pdf: pdfName,
      detected_hymns: parsed.starts,
      imported_hymns: imported.hymns.length,
      updates: bookUpdates,
    });
  }

  const result = await updateProduction(updates, dryRun);
  report.production_updated = result.updated;
  report.ambiguous_count = report.ambiguous.length;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "hymn-restructure-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
