import { SermonProjectionView } from "@/components/sermons/SermonProjectionView";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ p?: string }>;
};

function resolveStartIndex(
  paragraphs: { paragraph_number: number }[],
  pParam: string | undefined,
): number {
  if (!pParam?.trim()) return 0;
  const n = parseInt(pParam.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  const idx = paragraphs.findIndex((x) => x.paragraph_number === n);
  return idx >= 0 ? idx : 0;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `Projection | ${slug} | Moboko` };
}

export default async function SermonProjectPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  if (!supabase) notFound();

  const { data: sermon } = await supabase
    .from("sermons")
    .select("id, slug, title, preached_on, year, location, country, city")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (!sermon) notFound();

  const { data: paragraphs } = await supabase
    .from("sermon_paragraphs")
    .select("paragraph_number, paragraph_text")
    .eq("sermon_id", sermon.id)
    .order("paragraph_number", { ascending: true });

  const list = paragraphs ?? [];
  const initialIndex = resolveStartIndex(list, sp.p);

  const metaLine = [
    sermon.preached_on,
    sermon.year,
    [sermon.city, sermon.country].filter(Boolean).join(", ") || sermon.location,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SermonProjectionView
      slug={sermon.slug}
      sermonTitle={sermon.title}
      metaLine={metaLine}
      paragraphs={list}
      initialIndex={initialIndex}
    />
  );
}
