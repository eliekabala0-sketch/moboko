import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = resolve(import.meta.dirname, "..", "..");
const envPath = join(root, "apps", "web", ".env.local");
const sourceDir = join(root, "data", "sermons-rebuilt");

const samples = [
  { file: "LE PARDON TUCSON AZ USA Lun 28.10.63_195.txt", numbers: [75, 77] },
  { file: "L’AMOUR HARRISONBURG VA USA Jeu 13.03.58_085.txt", numbers: [46, 68] },
  { file: "ZACHEE, L’HOMME D’AFFAIRES TUCSON AZ USA Lun 21.01.63_034.txt", numbers: [16] },
];

function loadEnv() {
  const env = { ...process.env };
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const index = text.indexOf("=");
    const key = text.slice(0, index).trim();
    if (env[key]) continue;
    let value = text.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

function normalize(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim();
}

function parseParagraphs(file) {
  if (!existsSync(file)) throw new Error(`Source absente: ${file}`);
  const result = new Map();
  let number = null;
  let buffer = [];
  const flush = () => {
    if (number !== null) result.set(number, normalize(buffer.join("\n")));
    buffer = [];
  };
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*\[(\d+)\]\s*(.*)$/);
    if (match) {
      flush();
      number = Number(match[1]);
      buffer.push(match[2]);
    } else if (number !== null) buffer.push(line);
  }
  flush();
  return result;
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const comparisons = [];
  for (const sample of samples) {
    const source = parseParagraphs(join(sourceDir, sample.file));
    const { data: sermon, error: sermonError } = await supabase
      .from("sermons")
      .select("id,title,source_file")
      .eq("source_file", sample.file)
      .single();
    if (sermonError) throw sermonError;
    const { data: rows, error: paragraphError } = await supabase
      .from("sermon_paragraphs")
      .select("paragraph_number,paragraph_text")
      .eq("sermon_id", sermon.id)
      .in("paragraph_number", sample.numbers)
      .order("paragraph_number");
    if (paragraphError) throw paragraphError;
    const remote = new Map(rows.map((row) => [Number(row.paragraph_number), normalize(row.paragraph_text)]));
    for (const paragraphNumber of sample.numbers) {
      const localText = source.get(paragraphNumber) ?? "";
      const productionText = remote.get(paragraphNumber) ?? "";
      comparisons.push({
        source_file: sample.file,
        paragraph_number: paragraphNumber,
        source_length: localText.length,
        production_length: productionText.length,
        source_segments: localText.split(/\n\s*\n/).filter(Boolean).length,
        production_segments: productionText.split(/\n\s*\n/).filter(Boolean).length,
        exact_match: localText === productionText,
        tail_preserved: localText.slice(-80) === productionText.slice(-80),
      });
    }
  }

  const { data: searchRows, error: searchError } = await supabase.rpc("moboko_search_sermon_paragraphs", {
    p_query: "petites chaussures blanches",
    p_queries: null,
    p_sermon_slug: null,
    p_title_filter: "Le Pardon",
    p_year: 1963,
    p_location_filter: "Tucson",
    p_limit: 5,
    p_offset: 0,
  });
  if (searchError) throw searchError;
  const searchFound = (searchRows ?? []).some((row) => Number(row.paragraph_number) === 75);
  const report = {
    checked_at: new Date().toISOString(),
    comparisons,
    all_exact: comparisons.every((row) => row.exact_match && row.tail_preserved),
    normal_search: {
      query: "petites chaussures blanches",
      result_count: searchRows?.length ?? 0,
      le_pardon_paragraph_75_found: searchFound,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.all_exact || !searchFound) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
