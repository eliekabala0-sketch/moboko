import { SermonAiSearchPanel } from "@/components/sermons/SermonAiSearchPanel";
import { ConcordanceHitsView } from "@/components/sermons/ConcordanceHitsView";
import { SermonLibrarySearchForm } from "@/components/sermons/SermonLibrarySearchForm";
import { Masthead } from "@/components/layout/Masthead";
import { fetchPublicAppSettings } from "@/lib/data/public-app-settings";
import {
  buildParagraphExcerpt,
  sanitizeLikePattern,
  type ParagraphHitRow,
  type SermonListRow,
} from "@/lib/sermons/search";
import type { ConcordanceHit } from "@/lib/sermons/concordance-types";
import { fastRowsToConcordanceHits, fetchFastSermonSearch } from "@/lib/sermons/fast-search";
import { fetchNeighborParagraphs } from "@/lib/sermons/paragraph-neighbors";
import { consumeNormalSearchQuota } from "@/lib/billing/normal-search-quota";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
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
  const concordanceHits: ConcordanceHit[] = [];
  let paragraphSearchError: string | null = null;
  let quotaLine: string | null = null;

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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const admin = createSupabaseServiceClient();
      if (!admin) {
        paragraphSearchError = "Service de quota indisponible.";
      } else {
        const quota = await consumeNormalSearchQuota(
          admin,
          user?.id ?? null,
          pub.freeNormalSearchesPerMonth,
        );
        if (!quota.ok) {
          paragraphSearchError =
            quota.error === "auth_required"
              ? "Connectez-vous pour utiliser la recherche dans le texte."
              : "Limite mensuelle de recherches gratuites atteinte. Un abonnement actif donne un acces illimite.";
        } else if (quota.subscriptionActive) {
          quotaLine = "Abonnement actif : recherche normale illimitee.";
        } else if (quota.remaining != null) {
          quotaLine = `${quota.remaining} recherche${quota.remaining > 1 ? "s" : ""} gratuite${quota.remaining > 1 ? "s" : ""} restante${quota.remaining > 1 ? "s" : ""} ce mois-ci.`;
        }
      }
    }

    if (pq.length >= 2 && !paragraphSearchError) {
      const y = sy ? parseInt(sy, 10) : null;
      const admin = createSupabaseServiceClient();
      const fast = admin
        ? await fetchFastSermonSearch(admin, pq, {
            titleFilter: st,
            year: y != null && !Number.isNaN(y) && y >= 1000 && y <= 2100 ? y : null,
            locationFilter: sl,
            limit: 60,
            offset: 0,
          })
        : null;

      if (fast) {
        concordanceHits.push(
          ...fastRowsToConcordanceHits(fast.rows, {
            query: pq,
            source: "sermons-search",
            offset: 0,
            pageSize: 60,
            totalCount: fast.rows.length,
          }),
        );
        paragraphHits = concordanceHits.map((hit) => ({
          paragraph_number: hit.paragraph_number,
          paragraph_text: hit.paragraph_text,
          sermons: {
            slug: hit.slug,
            title: hit.title,
            year: hit.date && /^\d{4}$/.test(hit.date) ? Number(hit.date) : null,
            preached_on: hit.date && /^\d{4}-\d{2}-\d{2}$/.test(hit.date) ? hit.date : null,
            location: hit.location ?? null,
          },
        }));
      } else {
        const { data: paraData, error: paraErr } = await supabase
          .from("sermon_paragraphs")
          .select(
            `
            paragraph_number,
            paragraph_text,
            sermons ( slug, title, year, preached_on, location )
          `,
          )
          .textSearch("search_tsv", pq, { type: "websearch", config: "french" })
          .limit(60);

        if (paraErr) {
          paragraphSearchError = "La recherche est temporairement indisponible. Reessayez.";
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
                    preached_on: (sermon.preached_on as string | null) ?? null,
                    location: (sermon.location as string | null) ?? null,
                  }
                : null,
            } satisfies ParagraphHitRow;
          });
          paragraphHits.sort((a, b) => {
            const da = a.sermons?.preached_on ?? (a.sermons?.year != null ? `${a.sermons.year}-01-01` : "9999-12-31");
            const db = b.sermons?.preached_on ?? (b.sermons?.year != null ? `${b.sermons.year}-01-01` : "9999-12-31");
            const byDate = da.localeCompare(db);
            if (byDate !== 0) return byDate;
            return a.paragraph_number - b.paragraph_number;
          });
          for (const hit of paragraphHits) {
            const s = hit.sermons;
            if (!s?.slug) continue;
            const n = await fetchNeighborParagraphs(supabase, s.slug, hit.paragraph_number);
            concordanceHits.push({
              slug: s.slug,
              title: s.title,
              location: s.location ?? null,
              date: s.preached_on ?? (s.year != null ? String(s.year) : null),
              paragraph_number: hit.paragraph_number,
              paragraph_text: hit.paragraph_text,
              prev_paragraph_number: n.prev_paragraph_number,
              prev_paragraph_text: n.prev_paragraph_text,
              next_paragraph_number: n.next_paragraph_number,
              next_paragraph_text: n.next_paragraph_text,
              _query: pq,
              _total_count: paragraphHits.length,
              _has_more: false,
              _next_offset: null,
            });
          }
        }
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
            ) : concordanceHits.length > 0 ? (
              <div className="mt-4">
                {quotaLine ? <p className="mb-3 text-xs text-[var(--muted)]">{quotaLine}</p> : null}
                <ConcordanceHitsView hits={concordanceHits} />
              </div>
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
