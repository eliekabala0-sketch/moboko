import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const IN_DIR = path.resolve("data/import-ready");


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

function chunks(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function main() {
  const env = readEnv("apps/web/.env.local");
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const hymnFiles = ["crois-seulement.json", "hosanna.json", "pene-na-yo.json"];
  for (const file of hymnFiles) {
    const parsed = JSON.parse(fs.readFileSync(path.join(IN_DIR, file), "utf8"));
    const { data: book, error: bookError } = await supabase
      .from("hymn_books")
      .update({
        language: parsed.book.language,
        source_file_path: `library-sources/hymns/${parsed.book.slug}.pdf`,
        source_file_name: parsed.book.source_file,
        source_file_size: parsed.book.source_file_size,
        source_file_hash: parsed.book.source_file_hash,
        total_hymns: parsed.hymns.length,
        import_status: parsed.validation.anomalies?.length ? "needs_review" : "imported",
        import_report: parsed.validation,
        imported_at: new Date().toISOString(),
      })
      .eq("slug", parsed.book.slug)
      .select("id")
      .single();
    if (bookError) throw bookError;

    for (const chunk of chunks(parsed.hymns, 200)) {
      for (const hymn of chunk) {
        const number = String(hymn.number);
        const { error } = await supabase
          .from("hymns")
          .update({
            key_signature: hymn.key_signature,
            full_text: hymn.full_text,
            search_text: [parsed.book.name, number, hymn.title, hymn.full_text, hymn.chorus].filter(Boolean).join(" "),
            validation_status: hymn.validation_status ?? "valid",
            validation_notes: hymn.validation_notes ?? [],
            display_order: hymn.display_order ?? hymn.number,
          })
          .eq("book_id", book.id)
          .eq("number", number);
        if (error) throw error;
      }
    }
  }

  const bible = JSON.parse(fs.readFileSync(path.join(IN_DIR, "bible-biblio-1910.json"), "utf8"));
  const bibleSourceName = bible.version.source_file || path.basename(bible.version.source_file_path);
  const { data: version, error: versionError } = await supabase
    .from("bible_versions")
    .upsert(
      {
        name: bible.version.name,
        abbreviation: bible.version.abbreviation,
        language: bible.version.language,
        testament_scope: bible.version.testament_scope,
        source_file_path: `library-sources/bibles/${bibleSourceName}`,
        source_file_name: bible.version.source_file,
        source_file_size: bible.version.source_file_size,
        source_file_hash: bible.version.source_file_hash,
        total_books: bible.validation.total_books,
        total_chapters: bible.validation.total_chapters,
        total_verses: bible.validation.total_verses,
        import_status: bible.validation.anomalies?.length ? "needs_review" : "imported",
        import_report: bible.validation,
        imported_at: new Date().toISOString(),
        is_published: true,
      },
      { onConflict: "abbreviation" },
    )
    .select("id")
    .single();
  if (versionError) throw versionError;

  console.log("Bible passage metadata is synchronized by supabase/migrations/20260713190000_public_library_access_metadata.sql.");

  console.log(JSON.stringify({ hymn_books: hymnFiles.length, bible_version: bible.version.abbreviation, bible_passages: bible.passages.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
