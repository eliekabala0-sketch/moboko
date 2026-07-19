import { sanitizeLike } from "@/lib/library/format";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const version = (url.searchParams.get("version") ?? "LSG1910").trim().slice(0, 20) || "LSG1910";
  const book = (url.searchParams.get("book") ?? "").trim().slice(0, 80);
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 20) || 20));
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });

  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });

  const safe = sanitizeLike(q);
  const firstTerm = safe.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? safe;
  let query = admin
    .from("bible_passages")
    .select("translation, book, chapter, verse, text, book_number")
    .eq("translation", version)
    .limit(250);
  if (book) query = query.eq("book", book);
  query = query.or(`text.ilike.%${safe}%,text.ilike.%${firstTerm}%`);
  const { data, error } = await query.order("book_number", { ascending: true }).order("chapter", { ascending: true }).order("verse", { ascending: true });
  if (error) return NextResponse.json({ error: "recherche_bible_indisponible" }, { status: 500 });

  const nq = normalize(q);
  const terms = nq.split(/\s+/).filter(Boolean);
  const results = ((data ?? []) as Array<{ translation: string; book: string; chapter: number; verse: number; text: string }>).filter((row) => {
    const text = normalize(row.text);
    return terms.every((term) => text.includes(term));
  }).slice(0, limit).map((row) => ({
    translation: row.translation,
    book: row.book,
    chapter: row.chapter,
    verse: row.verse,
    text: row.text,
  }));

  return NextResponse.json({ ok: true, results });
}
