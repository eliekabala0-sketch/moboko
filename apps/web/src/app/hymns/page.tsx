import { Masthead } from "@/components/layout/Masthead";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { displayHymnNumber, sanitizeLike, significantTerms } from "@/lib/library/format";
import Link from "next/link";

export const metadata = {
  title: "Cantiques | Moboko",
};

type Props = {
  searchParams: Promise<{ book?: string; q?: string }>;
};

export default async function HymnsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const selectedBook = sp.book?.trim() ?? "";
  const q = sp.q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();
  let books: { id: string; name: string; slug: string; is_published: boolean }[] = [];
  let hymns: {
    slug: string;
    title: string;
    number: string | null;
    lyrics: string | null;
    hymn_books?: { name?: string | null; slug?: string | null } | { name?: string | null; slug?: string | null }[] | null;
  }[] = [];

  if (supabase) {
    const { data: bookRows } = await supabase
      .from("hymn_books")
      .select("id, name, slug, is_published")
      .eq("is_published", true)
      .order("name", { ascending: true });
    books = (bookRows ?? []) as typeof books;

    let query = supabase
      .from("hymns")
      .select("slug, title, number, lyrics, hymn_books ( name, slug )")
      .eq("is_published", true)
      .limit(q ? 80 : 180);

    if (selectedBook) query = query.eq("book_id", selectedBook);
    if (q) {
      const safe = sanitizeLike(q);
      const terms = significantTerms(q);
      if (/^\d+/.test(safe)) {
        query = query.or(`number.eq.${safe},number.ilike.${safe}%,title.ilike.%${safe}%,lyrics.ilike.%${safe}%`);
      } else {
        const best = terms[0] ?? safe;
        query = query.or(
          `title.eq.${safe},title.ilike.${safe}%,title.ilike.%${safe}%,lyrics.ilike.%${safe}%,title.ilike.%${best}%,lyrics.ilike.%${best}%`,
        );
      }
    }
    const { data: hymnRows } = await query.order("number", { ascending: true });
    hymns = (hymnRows ?? []) as typeof hymns;
  }

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Bibliotheque</p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">Cantiques</h1>

        <section className="mt-8 grid gap-3 md:grid-cols-3">
          {books.map((book) => (
            <Link
              key={book.id}
              href={`/hymns?book=${encodeURIComponent(book.id)}`}
              className={`moboko-card p-4 transition hover:border-[var(--border-strong)] ${
                selectedBook === book.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : ""
              }`}
            >
              <p className="font-semibold text-[var(--foreground)]">{book.name}</p>
            </Link>
          ))}
        </section>

        <form className="moboko-card mt-8 grid gap-4 p-5 md:grid-cols-[1fr_1.4fr_auto]">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Livre
            <select name="book" defaultValue={selectedBook} className="moboko-input mt-2">
              <option value="">Tous les livres</option>
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-[var(--foreground)]">
            Numero, titre ou paroles
            <input name="q" defaultValue={q} list="hymn-suggestions" className="moboko-input mt-2" placeholder="12, Crois seulement, seulement..." />
          </label>
          <button className="moboko-btn-primary self-end px-5 py-3 text-sm">Rechercher</button>
        </form>
        <datalist id="hymn-suggestions">
          {hymns.slice(0, 40).map((hymn) => (
            <option key={hymn.slug} value={`${displayHymnNumber(hymn.number)} ${hymn.title}`} />
          ))}
        </datalist>

        <section className="mt-8 grid gap-3">
          {hymns.map((hymn) => {
            const book = Array.isArray(hymn.hymn_books) ? hymn.hymn_books[0] : hymn.hymn_books;
            return (
              <article key={hymn.slug} className="moboko-card grid gap-4 p-4 md:grid-cols-[1fr_auto]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                    {book?.name} · {displayHymnNumber(hymn.number)}
                  </p>
                  <h2 className="font-display mt-2 text-xl font-semibold text-[var(--foreground)]">{hymn.title}</h2>
                  {q && hymn.lyrics ? (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">{hymn.lyrics}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/hymns/${book?.slug}/${encodeURIComponent(hymn.number ?? hymn.slug)}`} className="moboko-btn-primary px-5 py-2 text-sm">
                    Lire
                  </Link>
                  <Link href={`/projection?kind=hymn&hymn=${encodeURIComponent(hymn.slug)}`} className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]">
                    Projeter
                  </Link>
                </div>
              </article>
            );
          })}
          {hymns.length === 0 ? (
            <p className="moboko-card p-6 text-sm text-[var(--muted)]">Aucun cantique disponible pour cette recherche.</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}

