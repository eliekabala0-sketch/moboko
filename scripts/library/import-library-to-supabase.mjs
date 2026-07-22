import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const IN_DIR = path.resolve("data/import-ready");
const ENV_FILE = path.resolve("apps/web/.env.local");
const BATCH_SIZE = 500;
const STORAGE_BUCKET = "library-sources";

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

function slugify(input) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function chunks(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function searchText(parts) {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

async function ensureBucket(supabase) {
  const { data } = await supabase.storage.getBucket(STORAGE_BUCKET);
  if (data?.id) return;
  const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  return !error;
}

async function hasTable(supabase, table) {
  const { error } = await supabase.from(table).select("*").limit(1);
  return !error;
}

async function uploadSource(supabase, kind, sourcePath, preferredName) {
  const data = fs.readFileSync(sourcePath);
  const objectPath = `${kind}/${preferredName}`;
  const extension = path.extname(preferredName).toLowerCase();
  const contentType = extension === ".rtf" ? "application/rtf" : extension === ".json" ? "application/json" : "application/pdf";
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, data, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return `${STORAGE_BUCKET}/${objectPath}`;
}

async function importHymnBook(supabase, file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const book = parsed.book;
  const validation = parsed.validation ?? {};
  const sourcePath = await uploadSource(supabase, "hymns", book.source_file_path, `${book.slug}.pdf`);
  const richBooks = await hasColumn(supabase, "hymn_books", "import_report");
  const richHymns = await hasColumn(supabase, "hymns", "full_text");
  const report = {
    ...validation,
    source_file: book.source_file,
    extraction: book.extraction,
    pages: book.pages,
  };

  const bookPayload = richBooks
    ? {
        name: book.name,
        slug: book.slug,
        description: `${book.name} importé depuis PDF`,
        language: book.language,
        source_file_path: sourcePath,
        source_file_name: book.source_file,
        source_file_size: book.source_file_size,
        source_file_hash: book.source_file_hash,
        total_hymns: parsed.hymns.length,
        import_status: validation.anomalies?.length ? "needs_review" : "imported",
        import_report: report,
        imported_at: new Date().toISOString(),
        is_published: true,
      }
    : {
        name: book.name,
        slug: book.slug,
        description: `${book.name} importé depuis ${book.source_file}. ${parsed.hymns.length} chants détectés. Source: ${sourcePath}.`,
        is_published: true,
      };

  const { data: bookRow, error: bookError } = await supabase
    .from("hymn_books")
    .upsert(bookPayload, { onConflict: "slug" })
    .select("id")
    .single();
  if (bookError || !bookRow?.id) throw new Error(bookError?.message ?? `Livre introuvable: ${book.name}`);

  const rows = parsed.hymns.map((hymn) => {
    const base = {
      book_id: bookRow.id,
      number: String(hymn.number),
      title: hymn.title || `Cantique ${hymn.number}`,
      slug: slugify(`${book.slug}-${hymn.number}-${hymn.title || "cantique"}`),
      category: book.name,
      lyrics: hymn.full_text,
      verses: hymn.verses ?? [],
      chorus: hymn.chorus,
      is_published: true,
    };
    return richHymns
      ? {
          ...base,
          key_signature: hymn.key_signature,
          full_text: hymn.full_text,
          search_text: searchText([book.name, hymn.number, hymn.title, hymn.full_text, hymn.chorus]),
          validation_status: hymn.validation_status ?? "valid",
          validation_notes: hymn.validation_notes ?? [],
          display_order: hymn.display_order ?? hymn.number,
        }
      : base;
  });

  let imported = 0;
  for (const chunk of chunks(rows, BATCH_SIZE)) {
    const { error } = await supabase.from("hymns").upsert(chunk, { onConflict: richHymns ? "book_id,number" : "slug" });
    if (error) throw new Error(`Import ${book.name}: ${error.message}`);
    imported += chunk.length;
    console.log(`${book.name}: ${imported}/${rows.length} chants importés`);
  }
  return { name: book.name, count: rows.length, validation };
}

async function importBible(supabase, file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const version = parsed.version;
  const validation = parsed.validation ?? {};
  if (
    version.testament_scope === "complete" &&
    (validation.total_books !== 66 || validation.total_chapters !== 1189 || validation.total_verses < 31_100 || validation.anomalies?.length)
  ) {
    throw new Error("Import Bible refusé: la source déclarée complète ne passe pas les contrôles 66 livres / 1 189 chapitres / texte valide.");
  }
  const invalidPassages = parsed.passages.filter((passage) => passage.validation_status !== "valid" || !passage.text?.trim());
  if (invalidPassages.length) throw new Error(`Import Bible refusé: ${invalidPassages.length} passage(s) invalide(s).`);
  const sourceName = version.source_file || path.basename(version.source_file_path);
  const sourcePath = process.argv.includes("--skip-source-upload")
    ? `${STORAGE_BUCKET}/bibles/${sourceName}`
    : await uploadSource(supabase, "bibles", version.source_file_path, sourceName);
  const richBible = await hasTable(supabase, "bible_versions");
  const wordsOfJesusColumn = richBible && (await hasColumn(supabase, "bible_passages", "has_words_of_jesus"));
  const report = {
    ...validation,
    source_file: version.source_file,
    extraction: version.extraction,
    pages: version.pages,
  };

  let versionId = null;
  if (richBible) {
    const { data: versionRow, error: versionError } = await supabase
      .from("bible_versions")
      .upsert(
        {
          name: version.name,
          abbreviation: version.abbreviation,
          language: version.language,
          testament_scope: version.testament_scope,
          source_file_path: sourcePath,
          source_file_name: version.source_file,
          source_file_size: version.source_file_size,
          source_file_hash: version.source_file_hash,
          total_books: validation.total_books ?? 0,
          total_chapters: validation.total_chapters ?? 0,
          total_verses: validation.total_verses ?? parsed.passages.length,
          import_status: validation.anomalies?.length ? "needs_review" : "imported",
          import_report: report,
          imported_at: new Date().toISOString(),
          is_published: true,
        },
        { onConflict: "abbreviation" },
      )
      .select("id")
      .single();
    if (versionError || !versionRow?.id) throw new Error(versionError?.message ?? "Version Bible introuvable");
    versionId = versionRow.id;
  } else {
    console.log(`Bible: schéma metadata absent, import fallback dans bible_passages (${sourcePath})`);
  }

  const rows = parsed.passages.map((passage) => ({
    ...(richBible ? { version_id: versionId } : {}),
    translation: version.abbreviation,
    ...(richBible ? { book_number: passage.book_number } : {}),
    book: passage.book_name,
    ...(richBible ? { book_name: passage.book_name } : {}),
    chapter: passage.chapter,
    verse: passage.verse,
    text: passage.text,
    ...(richBible
      ? {
          search_text: passage.search_text ?? searchText([passage.book_name, `${passage.chapter}:${passage.verse}`, passage.text]),
          validation_status: passage.validation_status ?? "valid",
          ...(wordsOfJesusColumn ? { has_words_of_jesus: passage.has_words_of_jesus === true } : {}),
        }
      : {}),
  }));

  let imported = 0;
  for (const chunk of chunks(rows, BATCH_SIZE)) {
    const { error } = await supabase.from("bible_passages").upsert(chunk, {
      // La contrainte historique est une vraie contrainte UNIQUE. L'index enrichi
      // version_id/book_name est partiel et PostgreSQL ne peut pas toujours
      // l'utiliser comme arbitre ON CONFLICT selon l'état des migrations.
      onConflict: "translation,book,chapter,verse",
    });
    if (error) throw new Error(`Import Bible: ${error.message}`);
    imported += chunk.length;
    if (imported % 5000 === 0 || imported === rows.length) {
      console.log(`Bible LSG1910: ${imported}/${rows.length} versets importés`);
    }
  }
  return { name: version.name, count: rows.length, validation };
}

async function main() {
  const env = readEnv(ENV_FILE);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Variables Supabase manquantes dans apps/web/.env.local");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  await ensureBucket(supabase);

  const bibleOnly = process.argv.includes("--bible-only");
  const files = fs
    .readdirSync(IN_DIR)
    .filter((file) => file.endsWith(".json"))
    .filter((file) => (bibleOnly ? file === "bible-biblio-1910.json" : !file.includes("candidate") && !file.includes("report")));
  const results = [];
  for (const name of files) {
    const file = path.join(IN_DIR, name);
    if (name === "bible-biblio-1910.json") {
      results.push(await importBible(supabase, file));
    } else {
      results.push(await importHymnBook(supabase, file));
    }
  }
  console.log(JSON.stringify({ imported_at: new Date().toISOString(), results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
