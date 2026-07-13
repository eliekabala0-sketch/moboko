import { Masthead } from "@/components/layout/Masthead";
import { parsePositiveInt, sanitizeLike, significantTerms } from "@/lib/library/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = {
  title: "Bible | Moboko",
};

type Props = {
  searchParams: Promise<{ version?: string; book?: string; chapter?: string; verse?: string; q?: string }>;
};

const BOOK_ALIASES: Record<string, string> = {
  genese: "Genèse",
  genèse: "Genèse",
  ge: "Genèse",
  gn: "Genèse",
  psaume: "Psaumes",
  psaumes: "Psaumes",
  ps: "Psaumes",
  jn: "Jean",
  jean: "Jean",
};

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveBook(raw: string, books: string[]) {
  const key = normalizeKey(raw);
  if (BOOK_ALIASES[key]) return BOOK_ALIASES[key];
  return books.find((book) => normalizeKey(book) === key) ?? books.find((book) => normalizeKey(book).startsWith(key)) ?? raw;
}

function parseReference(q: string, books: string[]) {
  const m = q.trim().match(/^(.+?)\s+(\d{1,3})(?::(\d{1,3}))?$/);
  if (!m) return null;
  return {
    book: resolveBook(m[1] ?? "", books),
    chapter: Number(m[2]),
    verse: m[3] ? Number(m[3]) : null,
  };
}

export default async function BiblePage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  let versions: { abbreviation: string; name: string; testament_scope?: string | null }[] = [];
  let books: string[] = [];
  let chapters: number[] = [];
  let verses: { book: string; chapter: number; verse: number; text: string; translation: string }[] = [];
  let results: { book: string; chapter: number; verse: number; text: string; translation: string }[] = [];

  if (supabase) {
    const { data: versionRows } = await supabase
      .from("bible_versions")
      .select("abbreviation, name, testament_scope")
      .eq("is_published", true)
      .order("abbreviation", { ascending: true });
    versions = (versionRows ?? []) as typeof versions;
    if (versions.length === 0) versions = [{ abbreviation: "LSG1910", name: "Bible Louis Segond 1910", testament_scope: "partial" }];
    const selectedVersion = sp.version?.trim() || versions[0]?.abbreviation || "LSG1910";

    const { data: refRows } = await supabase
      .from("bible_passages")
      .select("book, chapter")
      .eq("translation", selectedVersion)
      .order("book", { ascending: true })
      .order("chapter", { ascending: true })
      .limit(40000);
    const bookMap = new Map<string, Set<number>>();
    for (const row of refRows ?? []) {
      const book = String(row.book);
      const set = bookMap.get(book) ?? new Set<number>();
      set.add(Number(row.chapter));
      bookMap.set(book, set);
    }
    books = [...bookMap.keys()];

    const q = sp.q?.trim() ?? "";
    const ref = q ? parseReference(q, books) : null;
    const selectedBook = ref?.book || sp.book?.trim() || books[0] || "";
    const selectedChapter = ref?.chapter || parsePositiveInt(sp.chapter) || (selectedBook ? Math.min(...(bookMap.get(selectedBook) ?? new Set([1]))) : 1);
    chapters = [...(bookMap.get(selectedBook) ?? new Set<number>())].sort((a, b) => a - b);

    if (selectedBook && selectedChapter) {
      let verseQuery = supabase
        .from("bible_passages")
        .select("translation, book, chapter, verse, text")
        .eq("translation", selectedVersion)
        .eq("book", selectedBook)
        .eq("chapter", selectedChapter)
        .order("verse", { ascending: true })
        .limit(180);
      if (ref?.verse) verseQuery = verseQuery.eq("verse", ref.verse);
      const { data: verseRows } = await verseQuery;
      verses = (verseRows ?? []) as typeof verses;
    }

    if (q && !ref) {
      const safe = sanitizeLike(q);
      const terms = significantTerms(q);
      const best = terms[0] ?? safe;
      let searchQuery = supabase
        .from("bible_passages")
        .select("translation, book, chapter, verse, text")
        .eq("translation", selectedVersion)
        .limit(80);
      if (sp.book) searchQuery = searchQuery.eq("book", resolveBook(sp.book, books));
      searchQuery = searchQuery.or(`text.ilike.%${safe}%,text.ilike.%${best}%`);
      const { data: resultRows } = await searchQuery.order("book", { ascending: true }).order("chapter", { ascending: true }).order("verse", { ascending: true });
      results = (resultRows ?? []) as typeof results;
    }
  }

  const selectedVersion = sp.version?.trim() || versions[0]?.abbreviation || "LSG1910";
  const q = sp.q?.trim() ?? "";
  const currentBook = sp.book?.trim() || verses[0]?.book || books[0] || "";
  const currentChapter = parsePositiveInt(sp.chapter) || verses[0]?.chapter || chapters[0] || 1;
  const chapterIndex = chapters.findIndex((chapter) => chapter === currentChapter);
  const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null;
  const nextChapter = chapterIndex >= 0 && chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : null;
  const versionMeta = versions.find((version) => version.abbreviation === selectedVersion);

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Bibliotheque</p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">Bible</h1>
        {versionMeta?.testament_scope !== "complete" ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Cette version contient uniquement les passages actuellement disponibles dans la bibliotheque Moboko.
          </p>
        ) : null}

        <form className="moboko-card mt-8 grid gap-4 p-5 md:grid-cols-[0.8fr_1fr_0.6fr_1.3fr_auto]">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Version
            <select name="version" defaultValue={selectedVersion} className="moboko-input mt-2">
              {versions.map((version) => (
                <option key={version.abbreviation} value={version.abbreviation}>
                  {version.abbreviation}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-[var(--foreground)]">
            Livre
            <select name="book" defaultValue={currentBook} className="moboko-input mt-2">
              {books.map((book) => (
                <option key={book} value={book}>
                  {book}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-[var(--foreground)]">
            Chapitre
            <select name="chapter" defaultValue={String(currentChapter)} className="moboko-input mt-2">
              {chapters.map((chapter) => (
                <option key={chapter} value={chapter}>
                  {chapter}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-[var(--foreground)]">
            Reference ou recherche
            <input name="q" defaultValue={q} className="moboko-input mt-2" placeholder="Jean 3:16, Psaume 23, amour..." />
          </label>
          <button className="moboko-btn-primary self-end px-5 py-3 text-sm">Ouvrir</button>
        </form>

        <div className="mt-6 flex flex-wrap gap-3">
          {prevChapter ? (
            <Link href={`/bible?version=${selectedVersion}&book=${encodeURIComponent(currentBook)}&chapter=${prevChapter}`} className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]">
              Chapitre precedent
            </Link>
          ) : null}
          {nextChapter ? (
            <Link href={`/bible?version=${selectedVersion}&book=${encodeURIComponent(currentBook)}&chapter=${nextChapter}`} className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]">
              Chapitre suivant
            </Link>
          ) : null}
          {verses.length > 0 ? (
            <Link href={`/projection?kind=bible&book=${encodeURIComponent(currentBook)}&chapter=${currentChapter}&project=1`} className="moboko-btn-primary px-5 py-2 text-sm">
              Projeter ce passage
            </Link>
          ) : null}
        </div>

        {results.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Resultats</h2>
            <div className="mt-4 grid gap-3">
              {results.map((row) => (
                <Link key={`${row.book}-${row.chapter}-${row.verse}`} href={`/bible?version=${row.translation}&book=${encodeURIComponent(row.book)}&chapter=${row.chapter}&q=${encodeURIComponent(`${row.book} ${row.chapter}:${row.verse}`)}`} className="moboko-card p-4 transition hover:border-[var(--border-strong)]">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                    {row.translation} · {row.book} {row.chapter}:{row.verse}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--foreground)]">{row.text}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-8">
          <h2 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            {currentBook} {currentChapter}
          </h2>
          <div className="mt-4 grid gap-3">
            {verses.map((row) => (
              <article key={`${row.book}-${row.chapter}-${row.verse}`} className="moboko-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                  {row.translation} · {row.book} {row.chapter}:{row.verse}
                </p>
                <p className="mt-2 text-base leading-relaxed text-[var(--foreground)]">{row.text}</p>
              </article>
            ))}
            {verses.length === 0 ? (
              <p className="moboko-card p-6 text-sm text-[var(--muted)]">Cette reference n&apos;est pas disponible dans cette version.</p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

