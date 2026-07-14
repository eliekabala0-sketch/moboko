import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const SOURCE_DIR = "C:/Users/user/Downloads/cantique";
const OUT_DIR = path.resolve("data/import-ready");
const ENV_FILE = path.resolve("apps/web/.env.local");

const BOOKS = [
  {
    slug: "pene-na-yo",
    pdf: /pene na yo/i,
    stanzaLines: 4,
    noMarkerStanzaLines: 8,
    gapFactor: 1.55,
    label: "parser-pene-na-yo",
  },
  {
    slug: "crois-seulement",
    pdf: /crois seulement/i,
    stanzaLines: 4,
    noMarkerStanzaLines: 4,
    gapFactor: 1.5,
    label: "parser-crois-seulement",
  },
  {
    slug: "hosanna",
    pdf: /hosana|hosanna/i,
    stanzaLines: 4,
    noMarkerStanzaLines: 4,
    gapFactor: 1.45,
    label: "parser-hosanna",
  },
];

const MARKER_RE = /^(refrain|choeur|chœur|chorus|r\.|c\.)\s*:?\s*/i;
const PAGE_SUFFIX_RE = /([,;:.!?])\s*(\d{1,3})$/;

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

function cleanLine(line, pageNumber = null) {
  let value = String(line ?? "").replace(/\t/g, " ").replace(/\s{2,}/g, " ").trim();
  if (pageNumber) {
    const suffix = value.match(PAGE_SUFFIX_RE);
    if (suffix && Number(suffix[2]) === pageNumber) value = value.replace(PAGE_SUFFIX_RE, "$1").trim();
  }
  return value;
}

function normalizeForMatch(text) {
  return cleanLine(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hymnIdentity(hymn) {
  return `${String(hymn.number ?? "").replace(/-conflit-\d+$/i, "")}|${normalizeForMatch(hymn.title ?? "")}`;
}

function remoteIdentity(row) {
  return `${String(row.number ?? "").replace(/-conflit-\d+$/i, "")}|${normalizeForMatch(row.title ?? "")}`;
}

function comparableVerses(value) {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify(
    value.map((verse, index) => ({
      number: Number(verse?.number ?? index + 1),
      text: String(typeof verse === "string" ? verse : verse?.text ?? "").trim(),
    })),
  );
}

function normalizeInvariant(text) {
  return normalizeForMatch(text.replace(MARKER_RE, " "));
}

function median(numbers) {
  const values = numbers.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (values.length === 0) return 0;
  return values[Math.floor(values.length / 2)] ?? 0;
}

function isNoiseLine(text) {
  return /^\d{1,4}$/.test(text) || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(text) || /^index$/i.test(text);
}

function stripMarker(line) {
  return cleanLine(line.replace(MARKER_RE, ""));
}

function firstSignificantLine(hymn) {
  return String(hymn.full_text ?? hymn.lyrics ?? "")
    .split(/\r?\n/g)
    .map(cleanLine)
    .find((line) => line && !MARKER_RE.test(line) && normalizeForMatch(line).length >= 8);
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
    for (const row of buckets) {
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
        const value = cleanLine(cluster.map((part) => part.text).join(" "), row.page);
        if (!value || isNoiseLine(value)) continue;
        pageLines.push({
          page: row.page,
          x: cluster[0]?.x ?? 0,
          y: row.y,
          height: row.height,
          text: value,
          norm: normalizeForMatch(value),
        });
      }
    }

    const columns = [];
    for (const line of pageLines.sort((a, b) => a.x - b.x)) {
      const column = columns.find((item) => Math.abs(item.x - line.x) < 80);
      if (column) {
        column.x = (column.x + line.x) / 2;
        column.lines.push(line);
      } else {
        columns.push({ x: line.x, lines: [line] });
      }
    }

    columns
      .sort((a, b) => a.x - b.x)
      .forEach((column, columnIndex) => {
        column.lines
          .sort((a, b) => b.y - a.y)
          .forEach((line) => lines.push({ ...line, column: columnIndex }));
      });
  }

  return lines;
}

function scoreLocation(line, hymn) {
  const title = normalizeForMatch(hymn.title ?? "");
  const firstLine = normalizeForMatch(firstSignificantLine(hymn) ?? "");
  const number = normalizeForMatch(String(hymn.number ?? "").replace(/-conflit-\d+$/i, ""));
  const norm = line.norm;
  let score = 0;
  let method = "none";

  if (title && number && norm.includes(number) && (norm.includes(title) || title.includes(norm.replace(number, "").trim()))) {
    score = 0.98;
    method = "number_title";
  } else if (title && title.length >= 8 && (norm.includes(title) || title.includes(norm))) {
    score = 0.9;
    method = "title";
  } else if (firstLine && firstLine.length >= 12 && (norm.includes(firstLine.slice(0, 28)) || firstLine.includes(norm.slice(0, 28)))) {
    score = 0.78;
    method = "first_line";
  }

  return { score, method };
}

function locateImportedHymns(lines, importedBook) {
  const locations = [];
  let cursor = 0;
  for (const hymn of importedBook.hymns) {
    let best = null;
    const searchLimit = Math.min(lines.length, cursor + 900);
    for (let index = cursor; index < searchLimit; index += 1) {
      const candidate = scoreLocation(lines[index], hymn);
      if (candidate.score > (best?.score ?? 0)) {
        best = { index, bodyStart: candidate.method === "first_line" ? index : index + 1, ...candidate };
        if (candidate.score >= 0.95) break;
      }
    }

    if (!best || best.score < 0.72) {
      locations.push({ hymn, index: null, bodyStart: null, score: 0, method: "unmatched" });
      continue;
    }

    locations.push({ hymn, ...best });
    cursor = best.index + 1;
  }
  return locations;
}

function removeHeadingLines(lines, hymn) {
  const title = normalizeForMatch(hymn.title ?? "");
  const number = normalizeForMatch(String(hymn.number ?? ""));
  return lines.filter((line) => {
    const norm = line.norm ?? normalizeForMatch(line.text);
    if (!norm) return false;
    if (title && norm.includes(title) && (!number || norm.includes(number))) return false;
    return true;
  });
}

function splitBlocks(lines, strategy) {
  if (lines.length === 0) return [];
  const gaps = [];
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1];
    const next = lines[i];
    if (prev.page !== next.page || prev.column !== next.column) continue;
    const gap = prev.y - next.y;
    if (gap > 0) gaps.push(gap);
  }
  const normalGap = median(gaps) || median(lines.map((line) => line.height)) || 10;
  const threshold = Math.max(normalGap * strategy.gapFactor, normalGap + 3.2);
  const blocks = [];
  let current = [lines[0]];

  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1];
    const next = lines[i];
    const sameFrame = prev.page === next.page && prev.column === next.column;
    const gap = sameFrame ? prev.y - next.y : normalGap;
    const markerBoundary = MARKER_RE.test(next.text);
    const pageColumnBoundary = prev.page !== next.page || prev.column !== next.column;
    if (gap > threshold || markerBoundary || (pageColumnBoundary && current.length >= strategy.stanzaLines)) {
      blocks.push(current);
      current = [];
    }
    current.push(next);
  }
  if (current.length) blocks.push(current);
  return blocks.map((block) => block.map((line) => cleanLine(line.text, line.page)).filter(Boolean)).filter((block) => block.length);
}

function linesFromFullText(hymn) {
  return String(hymn.full_text ?? hymn.lyrics ?? "")
    .split(/\r?\n/g)
    .map((line) => cleanLine(line))
    .filter(Boolean);
}

function hasExplicitMarker(hymn) {
  return linesFromFullText(hymn).some((line) => MARKER_RE.test(line));
}

function splitByLineCount(lines, size) {
  if (lines.length <= size) return [lines];
  const blocks = [];
  for (let i = 0; i < lines.length; i += size) blocks.push(lines.slice(i, i + size));
  return blocks.filter((block) => block.length);
}

function fallbackBlocksFromText(hymn, strategy) {
  const lines = linesFromFullText(hymn);
  const markerIndex = lines.findIndex((line) => MARKER_RE.test(line));
  if (markerIndex < 0) {
    return splitByLineCount(lines, strategy.noMarkerStanzaLines);
  }
  const before = lines.slice(0, markerIndex);
  const after = lines.slice(markerIndex + 1);
  const blocks = [];
  if (before.length) blocks.push(before);
  blocks.push([lines[markerIndex]]);
  blocks.push(...splitByLineCount(after, strategy.stanzaLines));
  return blocks;
}

function structureFromBlocks(blocks, hymn, strategy) {
  const verses = [];
  const notes = [];
  let chorus = null;
  let expectingChorus = false;
  const proposedBlocks = [];

  const normalizedBlocks = blocks
    .map((block) => block.map(cleanLine).filter(Boolean))
    .filter((block) => block.length > 0);

  for (let blockIndex = 0; blockIndex < normalizedBlocks.length; blockIndex += 1) {
    const block = normalizedBlocks[blockIndex];
    const first = block[0] ?? "";
    const marker = first.match(MARKER_RE);
    if (marker) {
      const firstText = stripMarker(first);
      const inline = [firstText, ...block.slice(1)].filter(Boolean);
      if (inline.length) {
        chorus = chorus ? `${chorus}\n${inline.join("\n")}` : inline.join("\n");
        proposedBlocks.push({ type: "chorus", text: inline.join("\n") });
      } else {
        expectingChorus = true;
        proposedBlocks.push({ type: "marker", text: first });
      }
      continue;
    }

    const text = block.join("\n").trim();
    if (!text) continue;
    if (expectingChorus) {
      chorus = chorus ? `${chorus}\n${text}` : text;
      proposedBlocks.push({ type: "chorus", text });
      expectingChorus = false;
      continue;
    }
    verses.push({ number: verses.length + 1, text });
    proposedBlocks.push({ type: "verse", number: verses.length, text });
  }

  const sourceNoMarker = linesFromFullText(hymn)
    .filter((line) => !MARKER_RE.test(line))
    .join("\n");
  const structuredTextInSourceOrder = proposedBlocks
    .filter((block) => block.type !== "marker")
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n");
  const textInvariantOk = normalizeInvariant(sourceNoMarker) === normalizeInvariant(structuredTextInSourceOrder);

  if (!textInvariantOk) notes.push("text_invariant_failed");
  if (expectingChorus) notes.push("chorus_marker_without_text");
  if (verses.length === 0) notes.push("no_verse_detected");
  if (verses.some((verse) => verse.text.split(/\r?\n/).length > strategy.noMarkerStanzaLines * 2)) {
    notes.push("oversized_verse_block");
  }
  if (hasExplicitMarker(hymn) && !chorus) notes.push("chorus_marker_unparsed");
  if (!hasExplicitMarker(hymn) && chorus) notes.push("chorus_without_marker");

  let confidence = "high";
  if (notes.length) confidence = "low";
  else if (verses.length <= 1 || proposedBlocks.length <= 1) confidence = "medium";

  return { verses, chorus, notes, proposedBlocks, confidence, textInvariantOk };
}

async function parseBookFromPdf(filePath, importedBook, strategy) {
  const lines = await extractPositionedLines(filePath);
  const locations = locateImportedHymns(lines, importedBook);
  const byNumber = new Map();
  const mapping = [];

  for (let i = 0; i < locations.length; i += 1) {
    const loc = locations[i];
    const next = locations.slice(i + 1).find((item) => item.index !== null);
    const sourceLines =
      loc.index === null
        ? []
        : removeHeadingLines(lines.slice(loc.bodyStart, next?.index ?? lines.length), loc.hymn);
    const pdfBlocks = sourceLines.length ? splitBlocks(sourceLines, strategy) : [];
    const fallbackBlocks = fallbackBlocksFromText(loc.hymn, strategy);
    const pdfStructured = pdfBlocks.length ? structureFromBlocks(pdfBlocks, loc.hymn, strategy) : null;
    const fallbackStructured = structureFromBlocks(fallbackBlocks, loc.hymn, strategy);
    const structured =
      pdfStructured?.textInvariantOk && pdfStructured.verses.length >= fallbackStructured.verses.length
        ? pdfStructured
        : fallbackStructured;

    const anomalies = [...structured.notes];
    if (loc.index === null) anomalies.push("pdf_source_unmatched");
    if (structured.confidence === "medium" && structured.verses.length <= 1) anomalies.push("single_block_structure");

    const confidence =
      loc.score >= 0.9 && structured.confidence === "high"
        ? "high"
        : loc.score >= 0.72 && structured.textInvariantOk
          ? "medium"
          : "low";

    byNumber.set(hymnIdentity(loc.hymn), {
      number: String(loc.hymn.number),
      title: loc.hymn.title,
      verses: structured.verses,
      chorus: structured.chorus,
      validation_notes: anomalies,
      confidence,
      validation_status: confidence === "high" ? "valid" : "needs_review",
      source_mapping: {
        parser: strategy.label,
        source_page_start: sourceLines[0]?.page ?? null,
        source_page_end: sourceLines.at(-1)?.page ?? null,
        match_confidence: Number(loc.score.toFixed(2)),
        match_method: loc.method,
        title_similarity: loc.method.includes("title") ? Number(loc.score.toFixed(2)) : null,
        first_line_similarity: loc.method === "first_line" ? Number(loc.score.toFixed(2)) : null,
      },
      structure_proposal: {
        blocks: structured.proposedBlocks,
        text_invariant_ok: structured.textInvariantOk,
      },
    });

    mapping.push({
      hymn_number: String(loc.hymn.number),
      title: loc.hymn.title,
      source_number: String(loc.hymn.number).replace(/-conflit-\d+$/i, ""),
      source_page_start: sourceLines[0]?.page ?? null,
      source_page_end: sourceLines.at(-1)?.page ?? null,
      match_confidence: Number(loc.score.toFixed(2)),
      match_method: loc.method,
      status: confidence,
      anomalies,
    });
  }

  return { byNumber, mapping };
}

async function updateProduction(updates, dryRun) {
  if (dryRun) return { updated: 0 };
  const env = readEnv(ENV_FILE);
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let updated = 0;
  for (const item of updates) {
    const { error: historyError } = await supabase.from("hymn_structure_history").insert({
      hymn_id: item.id,
      previous_verses: item.previous_verses,
      previous_chorus: item.previous_chorus,
      source: "automatic_restructure",
      snapshot: {
        number: item.number,
        book_slug: item.book_slug,
        confidence_score: item.confidence_score,
        anomalies: item.structure_anomalies,
        mode: item.mode,
      },
    });
    if (historyError) throw new Error(`${item.book_slug} ${item.number}: ${historyError.message}`);
    const payload =
      item.mode === "review_metadata"
        ? {
            validation_status: item.validation_status,
            validation_notes: item.validation_notes,
            confidence_score: item.confidence_score,
            source_mapping: item.source_mapping,
            structure_anomalies: item.structure_anomalies,
            structure_proposal: item.structure_proposal,
            structure_checked_at: new Date().toISOString(),
          }
        : {
            verses: item.verses,
            chorus: item.chorus,
            validation_status: item.validation_status,
            validation_notes: item.validation_notes,
            confidence_score: item.confidence_score,
            source_mapping: item.source_mapping,
            structure_anomalies: item.structure_anomalies,
            structure_proposal: item.structure_proposal,
            structure_checked_at: new Date().toISOString(),
          };
    const { error } = await supabase
      .from("hymns")
      .update(payload)
      .eq("id", item.id);
    if (error) throw new Error(`${item.book_slug} ${item.number}: ${error.message}`);
    updated += 1;
  }
  return { updated };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const applyNeedsReview = process.argv.includes("--apply-needs-review");
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
    total_hymns: 0,
    matched_to_pdf: 0,
    high: 0,
    medium: 0,
    low: 0,
    automatic_updates: 0,
    review_metadata_updates: 0,
    needs_review: 0,
    with_chorus: 0,
    without_chorus: 0,
    raw_text_changed: 0,
    unprocessed_without_reason: 0,
    books: [],
    mappings: [],
  };
  const updates = [];

  for (const strategy of BOOKS) {
    const bookRow = books?.find((book) => book.slug === strategy.slug);
    if (!bookRow) continue;
    const pdfName = pdfFiles.find((file) => strategy.pdf.test(file));
    if (!pdfName) throw new Error(`PDF missing for ${strategy.slug}`);
    const imported = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${strategy.slug}.json`), "utf8"));
    const parsed = await parseBookFromPdf(path.join(SOURCE_DIR, pdfName), imported, strategy);

    const { data: remoteRows, error: remoteError } = await supabase
      .from("hymns")
      .select("id, number, title, verses, chorus, validation_status, confidence_score, source_mapping, structure_anomalies")
      .eq("book_id", bookRow.id)
      .limit(1000);
    if (remoteError) throw remoteError;
    const remoteByNumber = new Map((remoteRows ?? []).map((row) => [String(row.number), row]));
    const remoteByIdentity = new Map((remoteRows ?? []).map((row) => [remoteIdentity(row), row]));
    let bookUpdates = 0;

    for (const hymn of imported.hymns) {
      report.total_hymns += 1;
      const structured = parsed.byNumber.get(hymnIdentity(hymn));
      const remote = remoteByIdentity.get(hymnIdentity(hymn)) ?? remoteByNumber.get(String(hymn.number));
      if (!structured || !remote?.id) {
        report.low += 1;
        report.needs_review += 1;
        report.unprocessed_without_reason += structured ? 0 : 1;
        continue;
      }

      if ((structured.source_mapping.match_confidence ?? 0) > 0) report.matched_to_pdf += 1;
      if (structured.confidence === "high") report.high += 1;
      else if (structured.confidence === "medium") report.medium += 1;
      else report.low += 1;
      if (structured.validation_status === "needs_review") report.needs_review += 1;
      if (structured.chorus) report.with_chorus += 1;
      else report.without_chorus += 1;

      const oldVerses = comparableVerses(remote.verses ?? []);
      const newVerses = comparableVerses(structured.verses);
      const oldChorus = remote.chorus ?? null;
      const newChorus = structured.chorus ?? null;
      const shouldApply = structured.confidence === "high" || applyNeedsReview;
      if (shouldApply && (oldVerses !== newVerses || oldChorus !== newChorus || structured.validation_status === "needs_review")) {
        updates.push({
          mode: "structure",
          id: remote.id,
          book_slug: strategy.slug,
          number: String(hymn.number),
          previous_verses: remote.verses ?? [],
          previous_chorus: remote.chorus ?? null,
          verses: structured.verses,
          chorus: newChorus,
          validation_status: structured.validation_status,
          validation_notes: structured.validation_notes,
          confidence_score: structured.confidence,
          source_mapping: structured.source_mapping,
          structure_anomalies: structured.validation_notes,
          structure_proposal: structured.structure_proposal,
        });
        bookUpdates += 1;
      } else if (
        structured.validation_status === "needs_review" &&
        (remote.validation_status !== "needs_review" ||
          remote.confidence_score !== structured.confidence ||
          JSON.stringify(remote.structure_anomalies ?? []) !== JSON.stringify(structured.validation_notes))
      ) {
        updates.push({
          mode: "review_metadata",
          id: remote.id,
          book_slug: strategy.slug,
          number: String(hymn.number),
          previous_verses: remote.verses ?? [],
          previous_chorus: remote.chorus ?? null,
          validation_status: structured.validation_status,
          validation_notes: structured.validation_notes,
          confidence_score: structured.confidence,
          source_mapping: structured.source_mapping,
          structure_anomalies: structured.validation_notes,
          structure_proposal: structured.structure_proposal,
        });
        report.review_metadata_updates += 1;
      }
    }

    report.automatic_updates += bookUpdates;
    report.mappings.push(...parsed.mapping.map((item) => ({ book: strategy.slug, ...item })));
    report.books.push({
      slug: strategy.slug,
      parser: strategy.label,
      pdf: pdfName,
      imported_hymns: imported.hymns.length,
      mapped_hymns: parsed.mapping.filter((item) => item.match_confidence > 0).length,
      updates: bookUpdates,
    });
  }

  const result = await updateProduction(updates, dryRun);
  report.production_updated = result.updated;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "hymn-restructure-report.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "hymn-source-mapping.json"), JSON.stringify(report.mappings, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
