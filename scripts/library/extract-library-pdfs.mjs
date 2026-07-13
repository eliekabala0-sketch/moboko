import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";

const SOURCE_DIR = "C:/Users/user/Downloads/cantique";
const OUT_DIR = path.resolve("data/import-ready");

const HYMN_BOOKS = [
  { match: /pene na yo/i, slug: "pene-na-yo", name: "Pene Na Yo", language: "ln" },
  { match: /crois seulement/i, slug: "crois-seulement", name: "Crois seulement", language: "fr" },
  { match: /hosana|hosanna/i, slug: "hosanna", name: "Hosanna", language: "fr" },
];

const BIBLE_MATCH = /bible|biblio|segond/i;

const BIBLE_BOOKS = [
  "Genèse",
  "Exode",
  "Lévitique",
  "Nombres",
  "Deutéronome",
  "Josué",
  "Juges",
  "Ruth",
  "1 Samuel",
  "2 Samuel",
  "1 Rois",
  "2 Rois",
  "1 Chroniques",
  "2 Chroniques",
  "Esdras",
  "Néhémie",
  "Esther",
  "Job",
  "Psaumes",
  "Proverbes",
  "Ecclésiaste",
  "Cantique",
  "Esaïe",
  "Jérémie",
  "Lamentations",
  "Ezéchiel",
  "Daniel",
  "Osée",
  "Joël",
  "Amos",
  "Abdias",
  "Jonas",
  "Michée",
  "Nahum",
  "Habacuc",
  "Sophonie",
  "Aggée",
  "Zacharie",
  "Malachie",
  "Matthieu",
  "Marc",
  "Luc",
  "Jean",
  "Actes",
  "Romains",
  "1 Corinthiens",
  "2 Corinthiens",
  "Galates",
  "Ephésiens",
  "Philippiens",
  "Colossiens",
  "1 Thessaloniciens",
  "2 Thessaloniciens",
  "1 Timothée",
  "2 Timothée",
  "Tite",
  "Philémon",
  "Hébreux",
  "Jacques",
  "1 Pierre",
  "2 Pierre",
  "1 Jean",
  "2 Jean",
  "3 Jean",
  "Jude",
  "Révélation",
];

const BIBLE_ALIASES = {
  "1 Thessalonicien": "1 Thessaloniciens",
  "2 Thessalonicien": "2 Thessaloniciens",
};

const EXPECTED_CHAPTERS = {
  Genèse: 50,
  Exode: 40,
  Lévitique: 27,
  Nombres: 36,
  Deutéronome: 34,
  Josué: 24,
  Juges: 21,
  Ruth: 4,
  "1 Samuel": 31,
  "2 Samuel": 24,
  "1 Rois": 22,
  "2 Rois": 25,
  "1 Chroniques": 29,
  "2 Chroniques": 36,
  Esdras: 10,
  Néhémie: 13,
  Esther: 10,
  Job: 42,
  Psaumes: 150,
  Proverbes: 31,
  Ecclésiaste: 12,
  Cantique: 8,
  Esaïe: 66,
  Jérémie: 52,
  Lamentations: 5,
  Ezéchiel: 48,
  Daniel: 12,
  Osée: 14,
  Joël: 3,
  Amos: 9,
  Abdias: 1,
  Jonas: 4,
  Michée: 7,
  Nahum: 3,
  Habacuc: 3,
  Sophonie: 3,
  Aggée: 2,
  Zacharie: 14,
  Malachie: 4,
  Matthieu: 28,
  Marc: 16,
  Luc: 24,
  Jean: 21,
  Actes: 28,
  Romains: 16,
  "1 Corinthiens": 16,
  "2 Corinthiens": 13,
  Galates: 6,
  Ephésiens: 6,
  Philippiens: 4,
  Colossiens: 4,
  "1 Thessaloniciens": 5,
  "2 Thessaloniciens": 3,
  "1 Timothée": 6,
  "2 Timothée": 4,
  Tite: 3,
  Philémon: 1,
  Hébreux: 13,
  Jacques: 5,
  "1 Pierre": 5,
  "2 Pierre": 3,
  "1 Jean": 5,
  "2 Jean": 1,
  "3 Jean": 1,
  Jude: 1,
  Révélation: 22,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function slugify(input) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanLine(line) {
  return line.replace(/\t/g, " ").replace(/\s{2,}/g, " ").trim();
}

function normalizeText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readPdf(filePath) {
  const data = fs.readFileSync(filePath);
  const parser = new PDFParse({ data });
  const result = await parser.getText({ parsePageInfo: true });
  await parser.destroy();
  return {
    filePath,
    fileName: path.basename(filePath),
    bytes: data.length,
    hash: sha256(data),
    pages: result.pages ?? [],
    text: normalizeText(result.text ?? ""),
    pageCount: result.total ?? result.pages?.length ?? 0,
  };
}

function splitHymnBody(body) {
  const blocks = body
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);
  let chorus = "";
  const verses = [];
  let currentVerse = [];

  for (const block of blocks.length ? blocks : [body]) {
    const isChorus = /^(choeur|chœur|chorus|refrain|r\.|c\.)\s*:?\s*$/i.test(block.split("\n")[0]?.trim() ?? "");
    if (isChorus) {
      const lines = block.split("\n").slice(1).map(cleanLine).filter(Boolean);
      chorus = lines.join("\n").trim();
      continue;
    }
    const lines = block.split("\n").map(cleanLine).filter(Boolean);
    for (const line of lines) {
      if (/^(choeur|chœur|chorus|refrain|r\.|c\.)\s*:?\s*$/i.test(line)) {
        if (currentVerse.length) {
          verses.push({ number: verses.length + 1, text: currentVerse.join("\n") });
          currentVerse = [];
        }
        chorus = "";
      } else if (chorus === "" && verses.length > 0 && /^(choeur|chœur|chorus|refrain|r\.|c\.)/i.test(line)) {
        chorus = line.replace(/^(choeur|chœur|chorus|refrain|r\.|c\.)\s*:?\s*/i, "").trim();
      } else if (chorus !== "" && currentVerse.length === 0 && verses.length > 0 && !line.match(/^[A-ZÀ-Ÿ]/)) {
        chorus += `\n${line}`;
      } else {
        currentVerse.push(line);
      }
    }
    if (currentVerse.length) {
      verses.push({ number: verses.length + 1, text: currentVerse.join("\n") });
      currentVerse = [];
    }
  }

  if (!chorus) {
    const lines = body.split("\n").map(cleanLine);
    const chorusIndex = lines.findIndex((line) => /^(choeur|chœur|chorus|refrain|r\.|c\.)\s*:?\s*$/i.test(line));
    if (chorusIndex >= 0) {
      const nextVerse = lines.findIndex((line, index) => index > chorusIndex && /^\d+\s*[.)-]/.test(line));
      chorus = lines.slice(chorusIndex + 1, nextVerse > 0 ? nextVerse : chorusIndex + 6).join("\n").trim();
    }
  }

  return { verses, chorus: chorus || null };
}

function parseHymns(pdf, config) {
  const rawLines = pdf.pages
    .flatMap((page) => String(page.text ?? "").split(/\r?\n/g))
    .map(cleanLine)
    .filter(Boolean);
  const lines = [];
  for (const line of rawLines) {
    if (/^\d{1,4}$/.test(line)) continue;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) continue;
    if (/^index$/i.test(line)) break;
    lines.push(line);
  }

  const starts = [];
  const heading = /^(?:N[°o.]?|No|Num[eé]ro|Cantique)?\s*(\d{1,4})\s*[.)-]\s+(.+)$/i;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(heading);
    if (!m) continue;
    const n = Number(m[1]);
    const title = m[2]?.trim() ?? "";
    if (n <= 0 || title.length < 2) continue;
    starts.push({ index: i, number: n, title });
  }

  const hymns = [];
  const anomalies = [];
  for (let i = 0; i < starts.length; i += 1) {
    const current = starts[i];
    const nextIndex = starts[i + 1]?.index ?? lines.length;
    let title = current.title;
    const bodyLines = lines.slice(current.index + 1, nextIndex);
    while (
      bodyLines.length > 0 &&
      title.length < 80 &&
      !/^(choeur|chœur|chorus|refrain|r\.|c\.)/i.test(bodyLines[0]) &&
      /^[A-ZÀ-Ÿ0-9'’ ,.!?-]+$/.test(bodyLines[0])
    ) {
      title += ` ${bodyLines.shift()}`;
    }
    let keySignature = null;
    const keyMatch = title.match(/\s+([A-G](?:b|#)?)\.?$/);
    if (keyMatch) {
      keySignature = keyMatch[1];
      title = title.slice(0, -keyMatch[0].length).trim();
    }
    const fullText = bodyLines.join("\n").trim();
    const split = splitHymnBody(fullText);
    const notes = [];
    if (!title) notes.push("missing_title");
    if (!fullText) notes.push("missing_text");
    if (fullText.length < 20) notes.push("short_text");
    if (!split.chorus && /choeur|chœur|chorus|refrain/i.test(fullText)) notes.push("chorus_marker_unparsed");
    if (notes.length) anomalies.push({ number: current.number, title, notes });
    hymns.push({
      number: current.number,
      title,
      key_signature: keySignature,
      verses: split.verses,
      chorus: split.chorus,
      full_text: fullText,
      validation_status: notes.length ? "needs_review" : "valid",
      validation_notes: notes,
      display_order: current.number,
    });
  }

  hymns.sort((a, b) => a.number - b.number);
  const seen = new Map();
  const duplicates = [];
  for (const hymn of hymns) {
    if (seen.has(hymn.number)) duplicates.push(hymn.number);
    seen.set(hymn.number, true);
  }
  const max = hymns.at(-1)?.number ?? 0;
  const missing = [];
  for (let i = 1; i <= max; i += 1) {
    if (!seen.has(i)) missing.push(i);
  }

  return {
    book: {
      name: config.name,
      slug: config.slug,
      language: config.language,
      source_file: pdf.fileName,
      source_file_path: pdf.filePath,
      source_file_size: pdf.bytes,
      source_file_hash: pdf.hash,
      pages: pdf.pageCount,
      extraction: "pdf-text",
    },
    hymns,
    validation: {
      total_hymns: hymns.length,
      max_number: max,
      missing_numbers: missing,
      duplicate_numbers: [...new Set(duplicates)],
      anomalies,
    },
  };
}

function parseBible(pdf) {
  const allBookLabels = [...BIBLE_BOOKS, ...Object.keys(BIBLE_ALIASES)];
  const bookSet = new Set(allBookLabels);
  const bookHeading = new RegExp(`^(${allBookLabels.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s+(\\d{1,3})$`);
  const lines = pdf.pages
    .flatMap((page) => String(page.text ?? "").split(/\r?\n/g))
    .map(cleanLine)
    .filter(Boolean)
    .filter((line) => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line));
  const passages = [];
  const anomalies = [];
  let currentBook = null;
  let currentBookNumber = 0;
  let currentChapter = 0;
  let current = null;

  function flush() {
    if (current?.text?.trim()) {
      current.text = current.text.replace(/\s+/g, " ").trim();
      current.search_text = `${current.book_name} ${current.chapter}:${current.verse} ${current.text}`;
      passages.push(current);
    }
    current = null;
  }

  for (const line of lines) {
    const heading = line.match(bookHeading);
    if (heading) {
      flush();
      currentBook = BIBLE_ALIASES[heading[1]] ?? heading[1];
      currentBookNumber = BIBLE_BOOKS.indexOf(currentBook) + 1;
      currentChapter = Number(heading[2]);
      continue;
    }
    if (bookSet.has(line)) {
      flush();
      currentBook = BIBLE_ALIASES[line] ?? line;
      currentBookNumber = BIBLE_BOOKS.indexOf(currentBook) + 1;
      currentChapter = 0;
      continue;
    }
    const verse = line.match(/^(\d{1,3})\.(\d{1,3})\s+(.+)$/);
    if (verse && currentBook) {
      flush();
      currentChapter = Number(verse[1]);
      current = {
        translation: "LSG1910",
        book_number: currentBookNumber,
        book: currentBook,
        book_name: currentBook,
        chapter: currentChapter,
        verse: Number(verse[2]),
        text: verse[3].trim(),
        validation_status: "valid",
      };
      continue;
    }
    if (current) {
      current.text += ` ${line}`;
    }
  }
  flush();

  const keySet = new Set();
  const duplicates = [];
  for (const row of passages) {
    const key = `${row.book_name}.${row.chapter}.${row.verse}`;
    if (keySet.has(key)) duplicates.push(key);
    keySet.add(key);
  }
  const books = new Set(passages.map((p) => p.book_name));
  const chapters = new Set(passages.map((p) => `${p.book_name}.${p.chapter}`));
  for (const book of BIBLE_BOOKS) {
    if (!books.has(book)) anomalies.push({ type: "missing_book", book });
  }
  for (const [book, expected] of Object.entries(EXPECTED_CHAPTERS)) {
    const present = new Set(passages.filter((p) => p.book_name === book).map((p) => p.chapter));
    const missing = [];
    for (let chapter = 1; chapter <= expected; chapter += 1) {
      if (!present.has(chapter)) missing.push(chapter);
    }
    if (missing.length) anomalies.push({ type: "missing_chapters", book, chapters: missing });
  }
  const isComplete = books.size === 66 && chapters.size === Object.values(EXPECTED_CHAPTERS).reduce((a, b) => a + b, 0);

  return {
    version: {
      name: "Bible Louis Segond 1910",
      abbreviation: "LSG1910",
      language: "fr",
      testament_scope: isComplete ? "complete" : "partial",
      source_file: pdf.fileName,
      source_file_path: pdf.filePath,
      source_file_size: pdf.bytes,
      source_file_hash: pdf.hash,
      pages: pdf.pageCount,
      extraction: "pdf-text",
    },
    passages,
    validation: {
      total_books: books.size,
      total_chapters: chapters.size,
      total_verses: passages.length,
      duplicate_refs: duplicates.slice(0, 100),
      anomalies,
    },
  };
}

async function main() {
  ensureDir(OUT_DIR);
  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((file) => file.toLowerCase().endsWith(".pdf"))
    .map((file) => path.join(SOURCE_DIR, file));
  const report = { generated_at: new Date().toISOString(), files: [] };

  for (const file of files) {
    const pdf = await readPdf(file);
    const textRatio = pdf.text.length / Math.max(1, pdf.pageCount);
    const entry = {
      file: pdf.fileName,
      bytes: pdf.bytes,
      pages: pdf.pageCount,
      text_length: pdf.text.length,
      text_extractible: pdf.text.length > 100,
      scanned_likely: textRatio < 100,
      extraction_quality: textRatio > 500 ? "good" : textRatio > 100 ? "partial" : "poor",
    };

    const hymnConfig = HYMN_BOOKS.find((book) => book.match.test(pdf.fileName));
    if (hymnConfig) {
      const parsed = parseHymns(pdf, hymnConfig);
      entry.type = "hymn_book";
      entry.language = hymnConfig.language;
      entry.detected_items = parsed.hymns.length;
      entry.validation = parsed.validation;
      fs.writeFileSync(path.join(OUT_DIR, `${hymnConfig.slug}.json`), JSON.stringify(parsed, null, 2), "utf8");
    } else if (BIBLE_MATCH.test(pdf.fileName)) {
      const parsed = parseBible(pdf);
      entry.type = "bible";
      entry.language = "fr";
      entry.detected_items = parsed.passages.length;
      entry.validation = parsed.validation;
      fs.writeFileSync(path.join(OUT_DIR, "bible-biblio-1910.json"), JSON.stringify(parsed, null, 2), "utf8");
    } else {
      entry.type = "unknown";
    }
    report.files.push(entry);
    console.log(`${entry.file}: ${entry.pages} pages, ${entry.type}, ${entry.detected_items ?? 0} items`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "library-import-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`Report: ${path.join(OUT_DIR, "library-import-report.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
