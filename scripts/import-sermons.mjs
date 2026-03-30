/**
 * Import des sermons .txt depuis le dossier CLEAN (structure officielle Moboko).
 *
 * Usage :
 *   node scripts/import-sermons.mjs [chemin_vers_CLEAN]
 *
 * Variables (apps/web/.env.local ou env) :
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Défaut chemin Windows officiel si MOBOKO_SERMON_CLEAN_DIR absent :
 *   C:\Users\user\Downloads\fichiers\SERMONS\CLEAN
 *
 * Anti-doublons : contrainte unique source_file + upsert ; réimport = remplacement des paragraphes.
 */
import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, "apps", "web", ".env.local");

function loadEnv() {
  const env = { ...process.env };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      let k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (env[k] == null || env[k] === "") env[k] = v;
    }
  }
  return env;
}

function slugifyBase(s) {
  const t = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return t || "sermon";
}

function shortHash(s) {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 10);
}

function normalizeForSearch(text) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** DD.MM.YY ou DD.MM.YYYY */
function parsePreachedDate(str) {
  if (!str || !str.trim()) return null;
  const m = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[1], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function parseYear(anneeLine, preachedIso) {
  if (anneeLine && /^\d{4}$/.test(anneeLine.trim())) {
    return parseInt(anneeLine.trim(), 10);
  }
  if (preachedIso) return parseInt(preachedIso.slice(0, 4), 10);
  return null;
}

function parseMeta(headerLines) {
  let title = "";
  let dateRaw = "";
  let lieu = "";
  let annee = "";
  for (const line of headerLines) {
    if (line.startsWith("Titre:")) title = line.slice(6).trim();
    else if (line.startsWith("Date:")) dateRaw = line.slice(5).trim();
    else if (line.startsWith("Lieu:")) lieu = line.slice(5).trim();
    else if (/^Année:\s*/i.test(line) || /^Annee:\s*/i.test(line)) {
      annee = line.replace(/^Ann[ée]e:\s*/i, "").trim();
    }
  }
  let preached_on = parsePreachedDate(dateRaw);
  if (!preached_on && lieu) {
    const m = lieu.match(/(\d{1,2}\.\d{1,2}\.\d{2,4})/);
    if (m) preached_on = parsePreachedDate(m[1]);
  }
  const year = parseYear(annee, preached_on);
  return { title, dateRaw, lieu, annee, preached_on, year };
}

function extractParagraphs(body) {
  const lines = body.split(/\r?\n/);
  const paras = [];
  let currentNum = null;
  let currentBuf = [];
  const flush = () => {
    if (currentNum != null) {
      const text = currentBuf.join("\n").trim();
      if (text) paras.push({ paragraph_number: currentNum, paragraph_text: text });
    }
    currentBuf = [];
  };
  const headerRe = /^\[(\d+)\]\s*(.*)$/;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      flush();
      currentNum = parseInt(m[1], 10);
      currentBuf.push(m[2] || "");
    } else if (currentNum != null) {
      currentBuf.push(line);
    }
  }
  flush();
  return paras;
}

function parseCityCountry(location) {
  if (!location || !location.trim()) return { city: null, country: null };
  const u = location.toUpperCase();
  let country = null;
  if (/\bUSA\b/.test(u)) country = "USA";
  else if (/\bSUISSE\b/.test(u)) country = "Suisse";
  const cityMatch = location.match(
    /\b([A-ZÀÂÄÉÈÊËÏÎÔÙÛÜÇa-zàâäéèêëïîôùûüç\s\-']{2,})\s+[A-Z]{2}\s+USA\b/i,
  );
  const city = cityMatch ? cityMatch[1].trim().replace(/\s+/g, " ") : null;
  return { city, country };
}

function parseSermonFile(fullPath, sourceFile) {
  const raw = readFileSync(fullPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const firstParaIdx = lines.findIndex((l) => /^\[\d+\]\s/.test(l.trim()));
  const headerLines = firstParaIdx === -1 ? lines : lines.slice(0, firstParaIdx);
  const body =
    firstParaIdx === -1 ? "" : lines.slice(firstParaIdx).join("\n").trim();

  const meta = parseMeta(headerLines);
  let title = meta.title || basename(sourceFile, ".txt");
  const paragraphs = extractParagraphs(body);
  const content_plain = paragraphs.map((p) => p.paragraph_text).join("\n\n");
  const { city, country } = parseCityCountry(meta.lieu);

  const baseSlug = slugifyBase(basename(sourceFile, ".txt"));
  const slug = `${baseSlug}-${shortHash(sourceFile)}`;

  return {
    slug,
    title,
    preached_on: meta.preached_on,
    year: meta.year,
    location: meta.lieu || null,
    country,
    city,
    series: null,
    source_file: sourceFile,
    content_plain,
    paragraph_count: paragraphs.length,
    language: "fr",
    is_published: true,
    paragraphs,
  };
}

async function main() {
  const env = loadEnv();
  const url =
    env.NEXT_PUBLIC_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    console.error(
      "Requis : NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY dans l’environnement ou apps/web/.env.local",
    );
    process.exit(1);
  }

  const defaultDir =
    process.platform === "win32"
      ? join("C:", "Users", "user", "Downloads", "fichiers", "SERMONS", "CLEAN")
      : join(root, "data", "sermons-clean");

  const dir =
    process.argv[2]?.trim() ||
    env.MOBOKO_SERMON_CLEAN_DIR?.trim() ||
    defaultDir;

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error("Dossier introuvable ou invalide :", dir);
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".txt"));
  console.log("Dossier :", dir);
  console.log("Fichiers .txt :", files.length);

  let imported = 0;
  let failed = 0;
  const errors = [];

  for (const f of files) {
    const full = join(dir, f);
    try {
      const row = parseSermonFile(full, f);

      const { data: upserted, error: upErr } = await supabase
        .from("sermons")
        .upsert(
          {
            slug: row.slug,
            title: row.title,
            preached_on: row.preached_on,
            year: row.year,
            location: row.location,
            country: row.country,
            city: row.city,
            series: row.series,
            source_file: row.source_file,
            content_plain: row.content_plain,
            paragraph_count: row.paragraph_count,
            language: row.language,
            is_published: row.is_published,
          },
          { onConflict: "source_file", ignoreDuplicates: false },
        )
        .select("id")
        .single();

      if (upErr) throw upErr;
      const sermonId = upserted.id;

      await supabase.from("sermon_paragraphs").delete().eq("sermon_id", sermonId);

      if (row.paragraphs.length > 0) {
        const chunkSize = 200;
        for (let i = 0; i < row.paragraphs.length; i += chunkSize) {
          const chunk = row.paragraphs.slice(i, i + chunkSize).map((p) => ({
            sermon_id: sermonId,
            paragraph_number: p.paragraph_number,
            paragraph_text: p.paragraph_text,
            normalized_text: normalizeForSearch(p.paragraph_text),
          }));
          const { error: insErr } = await supabase
            .from("sermon_paragraphs")
            .insert(chunk);
          if (insErr) throw insErr;
        }
      }

      imported++;
      if (imported % 100 === 0) console.log("…", imported, "/", files.length);
    } catch (e) {
      failed++;
      errors.push({ file: f, message: e?.message ?? String(e) });
    }
  }

  let notes =
    errors.length > 0
      ? errors
          .slice(0, 30)
          .map((e) => `${e.file}: ${e.message}`)
          .join("\n") + (errors.length > 30 ? `\n… +${errors.length - 30} autres` : "")
      : null;
  if (notes && notes.length > 50000) notes = notes.slice(0, 50000) + "\n…(tronqué)";

  await supabase.from("library_import_jobs").insert({
    source_type: "sermon_clean_txt",
    source_path: dir,
    imported_count: imported,
    failed_count: failed,
    notes,
  });

  console.log("Terminé — importés :", imported, "échecs :", failed);
  if (errors.length) {
    console.log("Premiers échecs :");
    errors.slice(0, 10).forEach((e) => console.log(" -", e.file, e.message));
    if (errors.length > 10) console.log(" …");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
