import { SermonAiSearchPanel } from "@/components/sermons/SermonAiSearchPanel";
import { SermonLibrarySearchForm } from "@/components/sermons/SermonLibrarySearchForm";
import { Masthead } from "@/components/layout/Masthead";
import { fetchPublicAppSettings } from "@/lib/data/public-app-settings";
import {
  buildParagraphExcerpt,
  sanitizeLikePattern,
  type ParagraphHitRow,
  type SermonListRow,
} from "@/lib/sermons/search";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = {
  title: "Sermons | Moboko",
  description: "Bibliothèque de sermons",
};

type PageProps = {
  searchParams: Promise<{ st?: string; sy?: string; sl?: string; pq?: string }>;
};

export default async function SermonsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const st = sp.st?.trim() ?? "";
  const sy = sp.sy?.trim() ?? "";
  const sl = sp.sl?.trim() ?? "";
  const pq = sp.pq?.trim() ?? "";

  const pub = await fetchPublicAppSettings();
  const supabase = await createSupabaseServerClient();

  let rows: SermonListRow[] = [];
  let paragraphHits: ParagraphHitRow[] = [];
  let paragraphSearchError: string | null = null;

  if (supabase) {
    let sermonQuery = supabase
      .from("sermons")
      .select("id, slug, title, preached_on, year, location, paragraph_count")
      .eq("is_published", true);

    const stSafe = sanitizeLikePattern(st);
    if (stSafe) {
      sermonQuery = sermonQuery.ilike("title", `%${stSafe}%`);
    }
    if (sy) {
      const y = parseInt(sy, 10);
      if (!Number.isNaN(y) && y >= 1000 && y <= 2100) {
        sermonQuery = sermonQuery.eq("year", y);
      }
    }
    const slSafe = sanitizeLikePattern(sl);
    if (slSafe) {
      sermonQuery = sermonQuery.ilike("location", `%${slSafe}%`);
    }

    const { data: sermonData } = await sermonQuery
      .order("preached_on", { ascending: false })
      .order("title", { ascending: true })
      .limit(400);

    rows = (sermonData ?? []) as SermonListRow[];

    if (pq.length >= 2) {
      const { data: paraData, error: paraErr } = await supabase
        .from("sermon_paragraphs")
        .select(
          `
          paragraph_number,
          paragraph_text,
          sermons ( slug, title, year )
        `,
        )
        .textSearch("search_tsv", pq, { type: "websearch", config: "french" })
        .limit(60);

      if (paraErr) {
        paragraphSearchError = paraErr.message;
      } else {
        paragraphHits = (paraData ?? []).map((row) => {
          const emb = row.sermons;
          const sermon = Array.isArray(emb) ? emb[0] : emb;
          return {
            paragraph_number: row.paragraph_number as number,
            paragraph_text: row.paragraph_text as string,
            sermons: sermon
              ? {
                  slug: sermon.slug as string,
                  title: sermon.title as string,
                  year: (sermon.year as number | null) ?? null,
                }
              : null,
          } satisfies ParagraphHitRow;
        });
      }
    }
  }

  const hasFilters = Boolean(st || sy || sl);
  const hasParagraphQuery = pq.length >= 2;

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Bibliothèque
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Sermons
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Filtres par titre, année et lieu ; recherche full-text dans les paragraphes (français) ; option assistée par IA
          pour les questions en langage naturel.
        </p>

        <SermonLibrarySearchForm st={st} sy={sy} sl={sl} pq={pq} />

        <div id="recherche-ia" className="scroll-mt-28">
          <SermonAiSearchPanel enabled={pub.sermonAiSearchEnabled} creditCost={pub.sermonAiSearchCreditCost} />
        </div>

        {hasParagraphQuery ? (
          <section className="mt-12">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Résultats dans le texte
            </h2>
            {paragraphSearchError ? (
              <p className="moboko-card mt-4 border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
                {paragraphSearchError}
              </p>
            ) : paragraphHits.length === 0 ? (
              <p className="moboko-card mt-4 p-6 text-sm text-[var(--muted)]">
                Aucun paragraphe ne correspond à « {pq} ».
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {paragraphHits.map((hit, i) => {
                  const s = hit.sermons;
                  if (!s?.slug) return null;
                  const readHref = `/sermons/${encodeURIComponent(s.slug)}#p-${hit.paragraph_number}`;
                  const projectHref = `/sermons/${encodeURIComponent(s.slug)}/project?p=${hit.paragraph_number}`;
                  const excerpt = buildParagraphExcerpt(hit.paragraph_text, pq);
                  return (
                    <li key={`${s.slug}-${hit.paragraph_number}-${i}`}>
                      <div className="moboko-card p-5 transition hover:border-[var(--border-strong)]">
                        <p className="font-medium text-[var(--foreground)]">{s.title}</p>
                        <p className="mt-1 text-xs text-[var(--accent)]">
                          Paragraphe [{hit.paragraph_number}]
                          {s.year != null ? ` · ${s.year}` : ""}
                        </p>
                        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{excerpt}</p>
                        <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
                          <Link href={readHref} className="text-[var(--accent)] hover:underline">
                            Lire (ancre)
                          </Link>
                          <Link href={projectHref} className="text-[var(--foreground)] hover:underline">
                            Projection
                          </Link>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : pq.length > 0 && pq.length < 2 ? (
          <p className="mt-8 text-sm text-[var(--muted)]">
            Saisissez au moins 2 caractères pour la recherche dans le texte.
          </p>
        ) : null}

        <section className={hasParagraphQuery ? "mt-14" : "mt-12"}>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {hasFilters ? "Sermons correspondants" : "Tous les sermons"}
          </h2>
          {rows.length === 0 ? (
            <p className="moboko-card mt-4 p-8 text-sm text-[var(--muted)]">
              {hasFilters
                ? "Aucun sermon ne correspond à ces critères."
                : "Aucun sermon publié pour l’instant. Exécutez l’import local (npm run import:sermons) après migration."}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {rows.map((s) => {
                const slugEnc = encodeURIComponent(s.slug);
                const meta = [
                  s.preached_on,
                  s.year ? `${s.year}` : null,
                  s.location,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={s.id}>
                    <div className="moboko-card p-5 transition hover:border-[var(--border-strong)]">
                      <Link href={`/sermons/${slugEnc}`} className="block">
                        <p className="font-medium text-[var(--foreground)] transition hover:text-[var(--accent)]">
                          {s.title}
                        </p>
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          {meta || "Sans date"}
                          {s.paragraph_count > 0
                            ? ` · ${s.paragraph_count} paragraphe${s.paragraph_count > 1 ? "s" : ""}`
                            : ""}
                        </p>
                      </Link>
                      <div className="mt-4 flex flex-wrap gap-4 border-t border-[var(--border)] pt-4 text-sm font-medium">
                        <Link href={`/sermons/${slugEnc}`} className="text-[var(--accent)] hover:underline">
                          Lecture
                        </Link>
                        <Link href={`/sermons/${slugEnc}/project`} className="text-[var(--foreground)] hover:underline">
                          Projection (début)
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
