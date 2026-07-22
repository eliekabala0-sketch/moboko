import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const defaults = {
  rtfDir: "C:\\Users\\user\\Downloads\\fichiers",
  cleanDir: "C:\\Users\\user\\Downloads\\fichiers\\SERMONS\\CLEAN",
  outDir: join(root, "data", "sermons-rebuilt"),
};

function args() {
  const result = { ...defaults };
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    const value = process.argv[i + 1];
    if (key === "--rtf-dir" && value) result.rtfDir = value;
    if (key === "--clean-dir" && value) result.cleanDir = value;
    if (key === "--out-dir" && value) result.outDir = value;
    if (key.startsWith("--") && value) i += 1;
  }
  return result;
}

const cp1252 = new TextDecoder("windows-1252");

function decodeRtfText(fragment) {
  let text = fragment.replace(/\r?\n/g, "");
  text = text.replace(/\\u(-?\d+)\??/g, (_, raw) => {
    const n = Number(raw);
    return String.fromCodePoint(n < 0 ? n + 65536 : n);
  });
  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) =>
    cp1252.decode(Uint8Array.of(Number.parseInt(hex, 16))),
  );
  text = text
    .replace(/\\emdash\b ?/g, "—")
    .replace(/\\endash\b ?/g, "–")
    .replace(/\\bullet\b ?/g, "•")
    .replace(/\\lquote\b ?/g, "‘")
    .replace(/\\rquote\b ?/g, "’")
    .replace(/\\ldblquote\b ?/g, "“")
    .replace(/\\rdblquote\b ?/g, "”")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\line\b ?/g, "\n")
    .replace(/\\par\b ?/g, "\n")
    .replace(/\\~|\\_/g, " ")
    .replace(/\\-/g, "")
    .replace(/\\([\\{}])/g, "$1")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/\\[^a-zA-Z]/g, "")
    .replace(/[{}]/g, "");
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function key(value) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function dateToken(value) {
  return value.match(/\b\d{1,2}\.\d{1,2}\.\d{2,4}[A-Z]?\b/i)?.[0]?.toUpperCase() ?? null;
}

function similarity(a, b) {
  const left = new Set(key(a).split(/[^A-Z0-9]+/).filter((word) => word.length > 1));
  const right = new Set(key(b).split(/[^A-Z0-9]+/).filter((word) => word.length > 1));
  let common = 0;
  for (const word of left) if (right.has(word)) common += 1;
  return left.size + right.size ? (2 * common) / (left.size + right.size) : 0;
}

function extractRtfSermons(fullPath) {
  const raw = readFileSync(fullPath, "utf8");
  const blocks = [];
  const chunks = raw.split(/\\pard \\s(?=\d+\b)/);
  for (let i = 1; i < chunks.length; i += 1) {
    const match = chunks[i].match(/^(10|12)\b([\s\S]*)$/);
    if (!match) continue;
    const text = decodeRtfText(match[2]);
    if (text) blocks.push({ style: Number(match[1]), text });
  }

  const sermons = [];
  let current = null;
  let pendingHeader = null;
  for (const block of blocks) {
    if (block.style === 10) {
      pendingHeader = block.text.replace(/\s+/g, " ").trim();
      continue;
    }
    if (!pendingHeader && !current) continue;
    if (pendingHeader && (!current || key(current.header) !== key(pendingHeader))) {
      current = { header: pendingHeader, paragraphs: [] };
      sermons.push(current);
    }
    const numbered = block.text.match(/^(\d+)\.\s*(.*)$/s);
    if (numbered) {
      current.paragraphs.push({ number: Number(numbered[1]), parts: [numbered[2].trim()] });
    } else if (current.paragraphs.length) {
      current.paragraphs.at(-1).parts.push(block.text.trim());
    }
    if (pendingHeader) pendingHeader = null;
  }
  return sermons;
}

function readClean(fullPath) {
  const raw = readFileSync(fullPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const title = raw.match(/^\uFEFF?Titre:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const first = lines.findIndex((line) => /^\[\d+\]\s*/.test(line));
  const paragraphs = [];
  let current = null;
  let parts = [];
  const flush = () => {
    if (current != null) paragraphs.push({ number: current, text: parts.join("\n").trim() });
    parts = [];
  };
  for (const line of first < 0 ? [] : lines.slice(first)) {
    const match = line.match(/^\[(\d+)\]\s*(.*)$/);
    if (match) {
      flush();
      current = Number(match[1]);
      parts.push(match[2]);
    } else if (current != null) parts.push(line);
  }
  flush();
  return { raw, lines, title, header: first < 0 ? lines : lines.slice(0, first), paragraphs };
}

function loose(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function main() {
  const options = args();
  for (const [name, path] of Object.entries(options)) {
    if (name !== "outDir" && !existsSync(path)) throw new Error(`Dossier introuvable: ${path}`);
  }
  mkdirSync(options.outDir, { recursive: true });

  const rtfFiles = readdirSync(options.rtfDir)
    .filter((file) => /^LE_MESSAGE.*\.rtf$/i.test(file))
    .sort();
  const cachePath = join(options.outDir, "extracted-rtf-v2.json");
  let extracted;
  if (existsSync(cachePath)) {
    extracted = JSON.parse(readFileSync(cachePath, "utf8"));
    console.log(`cache=${cachePath}|sermons=${extracted.length}`);
  } else {
    extracted = [];
    for (const file of rtfFiles) {
      const sermons = extractRtfSermons(join(options.rtfDir, file));
      extracted.push(...sermons);
      console.log(`rtf=${file}|sermons=${sermons.length}`);
    }
    writeFileSync(cachePath, JSON.stringify(extracted), "utf8");
  }
  const byHeader = new Map();
  const byDate = new Map();
  for (const sermon of extracted) {
    const k = key(sermon.header);
    const list = byHeader.get(k) ?? [];
    list.push(sermon);
    byHeader.set(k, list);
    const date = dateToken(sermon.header);
    if (date) byDate.set(date, [...(byDate.get(date) ?? []), sermon]);
  }

  const cleanFiles = readdirSync(options.cleanDir).filter((file) => file.toLowerCase().endsWith(".txt")).sort();
  const report = { rtfFiles: rtfFiles.length, extractedSermons: extracted.length, cleanFiles: cleanFiles.length, rebuilt: 0, fallbackMatches: 0, expandedParagraphs: 0, retainedParagraphs: 0, unmatched: [], ambiguous: [], paragraphParts: 0 };
  for (const file of cleanFiles) {
    const clean = readClean(join(options.cleanDir, file));
    const fileHeader = file.replace(/_\d+\.txt$/i, "");
    let matches = byHeader.get(key(clean.title)) ?? byHeader.get(key(fileHeader)) ?? [];
    if (!matches.length) {
      const dated = byDate.get(dateToken(fileHeader)) ?? [];
      if (dated.length === 1) matches = dated;
      else if (dated.length > 1) {
        const ranked = dated.map((sermon) => ({ sermon, score: similarity(fileHeader, sermon.header) })).sort((a, b) => b.score - a.score);
        if (ranked[0].score >= 0.55 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.08) matches = [ranked[0].sermon];
      }
      if (matches.length === 1) report.fallbackMatches += 1;
    }
    if (matches.length !== 1) {
      (matches.length ? report.ambiguous : report.unmatched).push({ file, title: clean.title, matches: matches.length });
      continue;
    }
    const sermon = matches[0];
    const date = dateToken(sermon.header)?.replace(/[A-Z]$/i, "") ?? "";
    const yearMatch = date.match(/(\d{2,4})$/);
    const year = yearMatch ? (yearMatch[1].length === 2 ? `19${yearMatch[1]}` : yearMatch[1]) : "";
    const metadata = [`Titre: ${sermon.header}`, `Date: ${date}`, `Lieu: ${sermon.header}`, `Année: ${year}`];
    const rtfByNumber = new Map();
    for (const paragraph of sermon.paragraphs) {
      rtfByNumber.set(paragraph.number, [...(rtfByNumber.get(paragraph.number) ?? []), paragraph]);
    }
    const body = clean.paragraphs.map((paragraph) => {
      const before = loose(paragraph.text);
      const candidates = (rtfByNumber.get(paragraph.number) ?? [])
        .map((candidate) => ({ candidate, text: candidate.parts.filter(Boolean).join("\n\n") }))
        .filter(({ text }) => loose(text).startsWith(before) && loose(text).length >= before.length)
        .sort((a, b) => loose(b.text).length - loose(a.text).length);
      const selected = candidates[0];
      if (selected && loose(selected.text).length > before.length) {
        report.expandedParagraphs += 1;
        report.paragraphParts += selected.candidate.parts.length;
        return `[${paragraph.number}] ${selected.text}`;
      }
      report.retainedParagraphs += 1;
      report.paragraphParts += 1;
      return `[${paragraph.number}] ${paragraph.text}`;
    });
    writeFileSync(join(options.outDir, file), `${metadata.join("\n")}\n\n${body.join("\n")}\n`, "utf8");
    report.rebuilt += 1;
  }
  const reportPath = join(options.outDir, "rebuild-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ ...report, unmatched: report.unmatched.length, ambiguous: report.ambiguous.length, reportPath }, null, 2));
  if (report.unmatched.length || report.ambiguous.length) process.exitCode = 2;
}

main();
