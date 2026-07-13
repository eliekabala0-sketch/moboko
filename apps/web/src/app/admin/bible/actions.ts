"use server";

import { requireAdmin } from "@/lib/admin/require-admin";
import { revalidatePath } from "next/cache";

type BibleRow = {
  translation: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
};

async function readImportText(formData: FormData) {
  const pasted = String(formData.get("bible_text") ?? "").trim();
  const file = formData.get("bible_file");
  if (file && typeof file === "object" && "name" in file && "size" in file) {
    const upload = file as File;
    if (upload.size > 0) {
      const name = upload.name.toLowerCase();
      const type = upload.type.toLowerCase();
      if (name.endsWith(".pdf") || type.includes("pdf")) {
        throw new Error("PDF detecte: importez une Bible en JSON, CSV ou TXT structure.");
      }
      if (name.endsWith(".docx") || type.includes("word")) {
        throw new Error("DOCX detecte: convertissez la Bible en JSON, CSV ou TXT structure.");
      }
      if (!/\.(json|csv|txt)$/.test(name) && type && !type.startsWith("text/") && !type.includes("json")) {
        throw new Error("Format non pris en charge. Utilisez JSON, CSV ou TXT.");
      }
      return upload.text().then((text) => text.trim());
    }
  }
  return pasted;
}

function positiveInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function parseJson(raw: string, fallbackTranslation: string): BibleRow[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed && "verses" in parsed && Array.isArray((parsed as { verses?: unknown }).verses)
      ? (parsed as { verses: unknown[] }).verses
      : [];
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      translation: String(r.translation ?? r.version ?? fallbackTranslation).trim() || fallbackTranslation,
      book: String(r.book ?? r.livre ?? "").trim(),
      chapter: positiveInt(r.chapter ?? r.chapitre),
      verse: positiveInt(r.verse ?? r.verset),
      text: String(r.text ?? r.texte ?? "").trim(),
    };
  });
}

function splitCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function parseDelimited(raw: string, fallbackTranslation: string) {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const first = splitCsvLine(lines[0]!);
  const hasHeader = first.some((cell) => /^(translation|version|book|livre|chapter|chapitre|verse|verset|text|texte)$/i.test(cell));
  const header = hasHeader ? first.map((cell) => cell.toLowerCase()) : [];
  const body = hasHeader ? lines.slice(1) : lines;
  return body.map((line) => {
    const cells = splitCsvLine(line);
    if (hasHeader) {
      const get = (...names: string[]) => {
        const index = header.findIndex((h) => names.includes(h));
        return index >= 0 ? cells[index] : "";
      };
      return {
        translation: get("translation", "version") || fallbackTranslation,
        book: get("book", "livre"),
        chapter: positiveInt(get("chapter", "chapitre")),
        verse: positiveInt(get("verse", "verset")),
        text: get("text", "texte"),
      };
    }
    if (cells.length >= 5) {
      return {
        translation: cells[0] || fallbackTranslation,
        book: cells[1] || "",
        chapter: positiveInt(cells[2]),
        verse: positiveInt(cells[3]),
        text: cells.slice(4).join(", ").trim(),
      };
    }
    return {
      translation: fallbackTranslation,
      book: cells[0] || "",
      chapter: positiveInt(cells[1]),
      verse: positiveInt(cells[2]),
      text: cells.slice(3).join(", ").trim(),
    };
  });
}

function parseReferenceLines(raw: string, fallbackTranslation: string) {
  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.+?)\s+(\d{1,3}):(\d{1,3})\s+(.+)$/);
      return {
        translation: fallbackTranslation,
        book: m?.[1]?.trim() ?? "",
        chapter: positiveInt(m?.[2]),
        verse: positiveInt(m?.[3]),
        text: m?.[4]?.trim() ?? "",
      };
    });
}

function parseBibleRows(raw: string, fallbackTranslation: string) {
  const json = parseJson(raw, fallbackTranslation);
  const rows = json ?? (raw.includes(",") ? parseDelimited(raw, fallbackTranslation) : parseReferenceLines(raw, fallbackTranslation));
  const valid = rows.filter((row) => row.translation && row.book && row.chapter > 0 && row.verse > 0 && row.text);
  if (valid.length === 0) {
    throw new Error("Aucun verset valide detecte. Formats: JSON, CSV, ou lignes 'Jean 3:16 Texte'.");
  }
  return valid;
}

export async function importBibleAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const translation = String(formData.get("translation") ?? "LSG").trim().toUpperCase() || "LSG";
  const raw = await readImportText(formData);
  if (!raw) throw new Error("Fichier ou texte biblique requis");
  const rows = parseBibleRows(raw, translation);
  if (rows.length > 40000) throw new Error("Import trop volumineux pour une seule operation");
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("bible_passages").upsert(chunk, {
      onConflict: "translation,book,chapter,verse",
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/admin/bible");
  revalidatePath("/projection");
}
