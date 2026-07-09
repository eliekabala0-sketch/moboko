import { ScrollToSermonHash } from "@/components/sermons/ScrollToSermonHash";
import { Masthead } from "@/components/layout/Masthead";
import { consumeNormalSearchQuota } from "@/lib/billing/normal-search-quota";
import { fetchPublicAppSettings } from "@/lib/data/public-app-settings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { paragraphMatchesQuery } from "@/lib/sermons/search";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ q?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `Sermon | ${slug} | Moboko` };
}

export default async function SermonDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const q = sp.q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();
  if (!supabase) notFound();
  const pub = await fetchPublicAppSettings();

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

  const allParagraphs = paragraphs ?? [];
  let searchError: string | null = null;
  let quotaLine: string | null = null;
  if (q.length >= 2) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const admin = createSupabaseServiceClient();
    if (!admin) {
      searchError = "Service de quota indisponible.";
    } else {
      const quota = await consumeNormalSearchQuota(
        admin,
        user?.id ?? null,
        pub.freeNormalSearchesPerMonth,
      );
      if (!quota.ok) {
        searchError =
          quota.error === "auth_required"
            ? "Connectez-vous pour chercher dans ce sermon."
            : "Limite mensuelle de recherches gratuites atteinte. Un abonnement actif donne un acces illimite.";
      } else if (quota.subscriptionActive) {
        quotaLine = "Abonnement actif : recherche normale illimitee.";
      } else if (quota.remaining != null) {
        quotaLine = `${quota.remaining} recherche${quota.remaining > 1 ? "s" : ""} gratuite${quota.remaining > 1 ? "s" : ""} restante${quota.remaining > 1 ? "s" : ""} ce mois-ci.`;
      }
    }
  }

  const searchActive = q.length >= 2 && !searchError;
  const visibleParagraphs = searchActive
    ? allParagraphs.filter((p) => paragraphMatchesQuery(p.paragraph_text, q))
    : allParagraphs;

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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/sermons"
            className="text-sm font-medium text-[var(--accent)] transition hover:text-[var(--foreground)]"
          >
            ← Tous les sermons
          </Link>
          <Link
            href="/sermons#recherche-ia"
            className="text-sm text-[var(--muted)] underline-offset-4 transition hover:text-[var(--accent)] hover:underline"
          >
            Recherche (texte ou IA)
          </Link>
        </div>
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

        <form action={`/sermons/${encodeURIComponent(slug)}`} method="get" className="moboko-card mt-8 p-5 sm:p-6">
          <label className="block text-sm font-medium text-[var(--foreground)]">
            <span className="text-[var(--muted)]">Chercher dans ce sermon</span>
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Mot ou expression exacte"
              className="moboko-input mt-2"
              autoComplete="off"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" className="moboko-btn-primary px-5 py-2.5 text-[13px]">
              Rechercher
            </button>
            {q ? (
              <Link
                href={`/sermons/${encodeURIComponent(slug)}`}
                className="inline-flex items-center rounded-full border border-[var(--border)] px-5 py-2.5 text-[13px] font-semibold text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
              >
                Effacer
              </Link>
            ) : null}
          </div>
          {q.length > 0 && q.length < 2 ? (
            <p className="mt-3 text-xs text-[var(--muted)]">Saisissez au moins 2 caracteres.</p>
          ) : null}
          {quotaLine ? <p className="mt-3 text-xs text-[var(--muted)]">{quotaLine}</p> : null}
          {searchError ? <p className="mt-3 text-sm text-[var(--danger)]">{searchError}</p> : null}
          {searchActive ? (
            <p className="mt-3 text-xs text-[var(--muted)]">
              {visibleParagraphs.length} paragraphe{visibleParagraphs.length > 1 ? "s" : ""} trouve{visibleParagraphs.length > 1 ? "s" : ""}.
            </p>
          ) : null}
        </form>

        <div className="mt-10 space-y-6">
          {allParagraphs.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Aucun paragraphe structuré pour ce fichier.</p>
          ) : visibleParagraphs.length === 0 ? (
            <p className="moboko-card p-6 text-sm text-[var(--muted)]">
              Aucun paragraphe ne correspond a cette recherche dans ce sermon.
            </p>
          ) : (
            visibleParagraphs.map((p) => (
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
