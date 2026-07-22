import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE = path.resolve("data/folio-bible/wbench_bible_fr.RTF");
const DEFAULT_CURRENT = path.resolve("data/import-ready/bible-biblio-1910.json");
const DEFAULT_OUTPUT = DEFAULT_CURRENT;

const BOOKS = [
  "Genèse", "Exode", "Lévitique", "Nombres", "Deutéronome", "Josué", "Juges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Rois", "2 Rois", "1 Chroniques", "2 Chroniques", "Esdras",
  "Néhémie", "Esther", "Job", "Psaumes", "Proverbes", "Ecclésiaste", "Cantique", "Esaïe",
  "Jérémie", "Lamentations", "Ezéchiel", "Daniel", "Osée", "Joël", "Amos", "Abdias", "Jonas",
  "Michée", "Nahum", "Habacuc", "Sophonie", "Aggée", "Zacharie", "Malachie", "Matthieu", "Marc",
  "Luc", "Jean", "Actes", "Romains", "1 Corinthiens", "2 Corinthiens", "Galates", "Ephésiens",
  "Philippiens", "Colossiens", "1 Thessaloniciens", "2 Thessaloniciens", "1 Timothée", "2 Timothée",
  "Tite", "Philémon", "Hébreux", "Jacques", "1 Pierre", "2 Pierre", "1 Jean", "2 Jean", "3 Jean",
  "Jude", "Révélation",
];

const EXPECTED_CHAPTERS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8,
  66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16,
  13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];

const BOOK_ALIASES = new Map([
  ["Apocalypse", "Révélation"],
  ["Ésaïe", "Esaïe"],
  ["Éphésiens", "Ephésiens"],
]);

const cp1252 = new TextDecoder("windows-1252");
const utf8 = new TextDecoder("utf-8", { fatal: true });
const cp1252Bytes = new Map(
  Array.from({ length: 256 }, (_, byte) => [cp1252.decode(Uint8Array.of(byte)), byte]),
);

function repairUtf8Mojibake(value) {
  if (!/[ÃÂ]/.test(value)) return value;
  try {
    return utf8.decode(Uint8Array.from([...value].map((character) => cp1252Bytes.get(character) ?? character.codePointAt(0))));
  } catch {
    return value;
  }
}

function parseArgs() {
  const values = { source: DEFAULT_SOURCE, current: DEFAULT_CURRENT, output: DEFAULT_OUTPUT, report: null };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key === "--source" && value) values.source = path.resolve(value);
    else if (key === "--current" && value) values.current = path.resolve(value);
    else if (key === "--output" && value) values.output = path.resolve(value);
    else if (key === "--report" && value) values.report = path.resolve(value);
    else continue;
    index += 1;
  }
  values.report ??= path.join(path.dirname(values.output), "bible-folio-rebuild-report.json");
  return values;
}

function decodeRtf(fragment) {
  const decoded = fragment
    .replace(/\\u(-?\d+)\??/g, (_, raw) => String.fromCodePoint(Number(raw) < 0 ? Number(raw) + 65536 : Number(raw)))
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => cp1252.decode(Uint8Array.of(Number.parseInt(hex, 16))))
    .replace(/\\emdash\b ?/g, "—")
    .replace(/\\endash\b ?/g, "–")
    .replace(/\\bullet\b ?/g, "•")
    .replace(/\\lquote\b ?/g, "‘")
    .replace(/\\rquote\b ?/g, "’")
    .replace(/\\ldblquote\b ?/g, "“")
    .replace(/\\rdblquote\b ?/g, "”")
    .replace(/\\tab\b ?/g, " ")
    .replace(/\\line\b ?/g, "\n")
    .replace(/\\par\b ?/g, "\n")
    .replace(/\\~|\\_/g, " ")
    .replace(/\\-/g, "")
    .replace(/\\([\\{}])/g, "$1")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/[\r\n\t ]+/g, " ")
    .trim();
  // Certaines entrées Folio contiennent des octets UTF-8 eux-mêmes échappés
  // comme du Windows-1252 (par ex. Ã‰zÃ©chiel). Réparer seulement ces séquences.
  return decoded.replace(/(?:Ã.|Â.)+/g, repairUtf8Mojibake);
}

function normalizeBook(name) {
  if (/z.*chiel$/iu.test(name)) return "Ezéchiel";
  return BOOK_ALIASES.get(name) ?? name;
}

function refKey(row) {
  return `${row.book_name}.${row.chapter}.${row.verse}`;
}

function isCorruptText(text) {
  return !text || text.length < 2 || text.length > 2000 || /ö{8,}|�|&(?:[a-z]+|#\d+);/iu.test(text);
}

function extractFolio(raw) {
  const passages = [];
  const unknownBooks = new Set();
  const bibleStart = raw.search(/ANCIEN TESTAMENT/i);
  const paragraphs = raw.slice(Math.max(0, bibleStart)).split(/\\par\b ?/);
  let pending = null;
  let currentBook = null;
  const seenRefs = new Set();
  const passageByRef = new Map();
  for (const fragment of paragraphs) {
    const decoded = decodeRtf(fragment);
    const explicitReference = decoded.match(/^(.+?\D)\s*(\d{1,3})\.(\d{1,3})$/);
    const bareReference = !explicitReference && currentBook ? decoded.match(/^(\d{1,3})\.(\d{1,3})$/) : null;
    const reference = explicitReference ?? (bareReference ? [decoded, currentBook, bareReference[1], bareReference[2]] : null);
    if (reference) {
      const bookName = normalizeBook(reference[1]);
      const bookNumber = BOOKS.indexOf(bookName) + 1;
      if (!bookNumber) {
        unknownBooks.add(bookName);
        pending = null;
        continue;
      }
      pending = {
        translation: "LSG1910",
        book_number: bookNumber,
        book: bookName,
        book_name: bookName,
        chapter: Number(reference[2]),
        verse: Number(reference[3]),
      };
      currentBook = bookName;
      continue;
    }
    if (!pending || !decoded) continue;
    const text = decoded;
    const corrected = { ...pending };
    const duplicateKey = refKey(corrected);
    if (seenRefs.has(duplicateKey)) {
      const previous = passageByRef.get(duplicateKey);
      const previousPrinted = previous?.text.match(/^\((\d{1,3}):(\d{1,3})\)\s*/);
      if (previousPrinted && Number(previousPrinted[1]) === previous.chapter) {
        const printedVerse = Number(previousPrinted[2]);
        const printedKey = `${previous.book_name}.${previous.chapter}.${printedVerse}`;
        if (printedVerse !== previous.verse && !seenRefs.has(printedKey)) {
          seenRefs.delete(duplicateKey);
          passageByRef.delete(duplicateKey);
          previous.verse = printedVerse;
          previous.search_text = `${previous.book_name} ${previous.chapter}:${printedVerse} ${previous.text}`;
          seenRefs.add(printedKey);
          passageByRef.set(printedKey, previous);
        }
      }
    }
    passages.push({
      ...corrected,
      text,
      search_text: `${corrected.book_name} ${corrected.chapter}:${corrected.verse} ${text}`,
      validation_status: isCorruptText(text) ? "needs_review" : "valid",
      has_words_of_jesus: /\\cf1\b/.test(fragment),
    });
    seenRefs.add(refKey(corrected));
    passageByRef.set(refKey(corrected), passages.at(-1));
    pending = null;
  }
  return { passages, unknownBooks: [...unknownBooks] };
}

function validate(passages) {
  const refs = new Set();
  const duplicateRefs = [];
  const invalidRefs = [];
  const chapters = new Set();
  const books = new Set();
  for (const passage of passages) {
    const key = refKey(passage);
    if (refs.has(key)) duplicateRefs.push(key);
    refs.add(key);
    chapters.add(`${passage.book_name}.${passage.chapter}`);
    books.add(passage.book_name);
    if (isCorruptText(passage.text)) invalidRefs.push(key);
  }
  const missingChapters = [];
  BOOKS.forEach((book, bookIndex) => {
    for (let chapter = 1; chapter <= EXPECTED_CHAPTERS[bookIndex]; chapter += 1) {
      if (!chapters.has(`${book}.${chapter}`)) missingChapters.push(`${book}.${chapter}`);
    }
  });
  return {
    total_books: books.size,
    total_chapters: chapters.size,
    total_verses: passages.length,
    duplicate_refs: duplicateRefs,
    invalid_refs: invalidRefs,
    missing_chapters: missingChapters,
    words_of_jesus_verses: passages.filter((passage) => passage.has_words_of_jesus).length,
    anomalies: [
      ...(duplicateRefs.length ? [{ type: "duplicate_refs", refs: duplicateRefs }] : []),
      ...(invalidRefs.length ? [{ type: "invalid_text", refs: invalidRefs }] : []),
      ...(missingChapters.length ? [{ type: "missing_chapters", refs: missingChapters }] : []),
    ],
  };
}

function main() {
  const options = parseArgs();
  if (!fs.existsSync(options.source)) throw new Error(`Export Folio introuvable: ${options.source}`);
  const sourceBuffer = fs.readFileSync(options.source);
  const extracted = extractFolio(sourceBuffer.toString("utf8"));
  const sourceValidation = validate(extracted.passages);
  const previous = fs.existsSync(options.current) ? JSON.parse(fs.readFileSync(options.current, "utf8")) : { passages: [] };
  const previousByRef = new Map(previous.passages.map((row) => [refKey(row), row]));
  const nextByRef = new Map();
  const comparison = { added: 0, changed: 0, unchanged: 0, repaired: 0, retained_from_previous: 0 };

  for (const passage of extracted.passages) {
    const key = refKey(passage);
    const old = previousByRef.get(key);
    if (!old) comparison.added += 1;
    else if (old.text === passage.text) comparison.unchanged += 1;
    else {
      comparison.changed += 1;
      if (isCorruptText(old.text) && !isCorruptText(passage.text)) comparison.repaired += 1;
    }
    nextByRef.set(key, passage);
  }

  // Fusion sans régression : une référence antérieure valide n'est jamais supprimée
  // si une future source Folio devenait accidentellement incomplète.
  for (const old of previous.passages) {
    const key = refKey(old);
    if (!nextByRef.has(key) && !isCorruptText(old.text)) {
      nextByRef.set(key, { ...old, validation_status: old.validation_status ?? "valid" });
      comparison.retained_from_previous += 1;
    }
  }

  const passages = [...nextByRef.values()].sort((a, b) =>
    a.book_number - b.book_number || a.chapter - b.chapter || a.verse - b.verse,
  );
  const validation = validate(passages);
  const report = {
    generated_at: new Date().toISOString(),
    source: options.source,
    previous: options.current,
    output: options.output,
    unknown_books: extracted.unknownBooks,
    extracted_verses: extracted.passages.length,
    extracted_unique_verses: extracted.passages.length - sourceValidation.duplicate_refs.length,
    source_duplicate_refs: sourceValidation.duplicate_refs,
    ...comparison,
    validation,
  };
  if (extracted.unknownBooks.length || validation.anomalies.length || validation.total_books !== 66 || validation.total_chapters !== 1189 || validation.total_verses < 31_100) {
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.report, JSON.stringify(report, null, 2), "utf8");
    throw new Error(`Extraction refusée: contrôle d'intégrité incomplet. Voir ${options.report}`);
  }

  const result = {
    version: {
      name: "Bible Louis Segond 1910",
      abbreviation: "LSG1910",
      language: "fr",
      testament_scope: "complete",
      source_file: path.basename(options.source),
      source_file_path: options.source,
      source_file_size: sourceBuffer.length,
      source_file_hash: crypto.createHash("sha256").update(sourceBuffer).digest("hex"),
      extraction: "folio-rtf",
      source_application: "Shekinah Publications / Folio Views",
    },
    passages,
    validation,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(result, null, 2), "utf8");
  fs.writeFileSync(options.report, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
