import { ScrollToSermonHash } from "@/components/sermons/ScrollToSermonHash";
import { Masthead } from "@/components/layout/Masthead";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `Sermon | ${slug} | Moboko` };
}

export default async function SermonDetailPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) notFound();

  const { data: sermon } = await supabase
    .from("sermons")
    .select(
      "id, slug, title, preached_on, year, location, country, city, paragraph_count, source_file",
    )
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (!sermon) notFound();

  const { data: paragraphs } = await supabase
    .from("sermon_paragraphs")
    .select("paragraph_number, paragraph_text")
    .eq("sermon_id", sermon.id)
    .order("paragraph_number", { ascending: true });

  const metaLine = [
    sermon.preached_on,
    sermon.year,
    [sermon.city, sermon.country].filter(Boolean).join(", ") || sermon.location,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <ScrollToSermonHash />
      <article className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <Link
          href="/sermons"
          className="text-sm font-medium text-[var(--accent)] transition hover:text-[var(--foreground)]"
        >
          ← Tous les sermons
        </Link>
        <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          {sermon.title}
        </h1>
        {metaLine ? (
          <p className="mt-3 text-sm text-[var(--muted)]">{metaLine}</p>
        ) : null}
        <p className="mt-2 text-[11px] text-[var(--muted)] opacity-80">
          Source : {sermon.source_file}
        </p>

        <div className="mt-8">
          <Link
            href={`/sermons/${encodeURIComponent(slug)}/project`}
            className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--accent-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--accent)] transition hover:border-[var(--accent)]/40"
          >
            Mode projection
          </Link>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Lecture plein écran, paragraphe par paragraphe (téléphone, bureau ou vidéoprojecteur).
          </p>
        </div>

        <div className="mt-10 space-y-6">
          {(paragraphs ?? []).length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Aucun paragraphe structuré pour ce fichier.</p>
          ) : (
            (paragraphs ?? []).map((p) => (
              <section
                key={p.paragraph_number}
                className="moboko-card scroll-mt-24 p-5 sm:p-6"
                id={`p-${p.paragraph_number}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                    § {p.paragraph_number}
                  </p>
                  <Link
                    href={`/sermons/${encodeURIComponent(slug)}/project?p=${p.paragraph_number}`}
                    className="text-[11px] font-medium text-[var(--muted)] underline-offset-4 transition hover:text-[var(--accent)] hover:underline"
                  >
                    Ouvrir en projection
                  </Link>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--foreground)]">
                  {p.paragraph_text}
                </p>
              </section>
            ))
          )}
        </div>
      </article>
    </div>
  );
}
