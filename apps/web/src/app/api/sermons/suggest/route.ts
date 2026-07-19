import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SermonRow = {
  id: string;
  slug: string;
  title: string;
  preached_on: string | null;
  year: number | null;
  location: string | null;
  paragraph_count: number | null;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function score(row: SermonRow, q: string, terms: string[]) {
  const title = normalize(row.title);
  const location = normalize(row.location ?? "");
  let s = 0;
  if (title === q) s += 1000;
  if (title.startsWith(q)) s += 700;
  if (title.split(" ").some((word) => word.startsWith(q))) s += 450;
  if (terms.every((term) => title.includes(term))) s += 300;
  if (terms.every((term) => `${title} ${location}`.includes(term))) s += 180;
  if (title.includes(q)) s += 120;
  if (location.includes(q)) s += 30;
  return s;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("q") ?? "";
  const q = normalize(raw).slice(0, 80);
  const year = Number(url.searchParams.get("year") ?? "");
  const locationRaw = normalize(url.searchParams.get("location") ?? "");
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") ?? 12) || 12));
  if (!q) return NextResponse.json({ ok: true, suggestions: [] });

  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });

  let query = admin
    .from("sermons")
    .select("id, slug, title, preached_on, year, location, paragraph_count")
    .eq("is_published", true)
    .limit(1200);
  if (Number.isFinite(year) && year >= 1000 && year <= 2100) query = query.eq("year", year);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "suggestions_indisponibles" }, { status: 500 });

  const terms = q.split(/\s+/).filter((term) => term.length > 0);
  const suggestions = ((data ?? []) as SermonRow[])
    .filter((row) => !locationRaw || normalize(row.location ?? "").includes(locationRaw))
    .map((row) => ({ row, rank: score(row, q, terms) }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.row.title.localeCompare(b.row.title, "fr"))
    .slice(0, limit)
    .map(({ row }) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      year: row.year,
      preached_on: row.preached_on,
      location: row.location,
      paragraph_count: row.paragraph_count ?? 0,
    }));

  return NextResponse.json({ ok: true, suggestions });
}
