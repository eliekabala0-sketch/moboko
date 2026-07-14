import { Masthead } from "@/components/layout/Masthead";
import { ProjectionReader } from "@/components/projection/ProjectionReader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = {
  title: "Projection | Moboko",
};

type SearchParams = {
  kind?: string;
  slug?: string;
  hymn?: string;
  q?: string;
  year?: string;
  place?: string;
  p?: string;
  book?: string;
  chapter?: string;
  project?: string;
};

type Props = {
  searchParams: Promise<SearchParams>;
};

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function parsePositiveInt(value: string | undefined) {
  const n = Number.parseInt(clean(value), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveStartIndex(items: { number: number }[], wanted: number | null) {
  if (!wanted) return 0;
  const idx = items.findIndex((x) => x.number === wanted);
  return idx >= 0 ? idx : 0;
}

function hymnVerseText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    return typeof text === "string" ? text.trim() : "";
  }
  return "";
}

export default async function ProjectionPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const kind = clean(sp.kind) || "message";
  const q = clean(sp.q);
  const year = parsePositiveInt(sp.year);
  const place = clean(sp.place);
  const paragraph = parsePositiveInt(sp.p);

  if (supabase && kind === "message" && sp.slug) {
    const { data: sermon } = await supabase
      .from("sermons")
      .select("id, slug, title, preached_on, year, location, country, city")
      .eq("slug", sp.slug)
      .eq("is_published", true)
      .maybeSingle();

    if (sermon?.id) {
      const { data: paragraphs } = await supabase
        .from("sermon_paragraphs")
        .select("paragraph_number, paragraph_text")
        .eq("sermon_id", sermon.id)
        .order("paragraph_number", { ascending: true });
      const rows = (paragraphs ?? []).map((p) => ({
        number: p.paragraph_number as number,
        text: p.paragraph_text as string,
      }));
      const metaLine = [
        sermon.preached_on,
        sermon.year,
        [sermon.city, sermon.country].filter(Boolean).join(", ") || sermon.location,
      ]
        .filter(Boolean)
        .join(" Â· ");

      return (
        <ProjectionReader
          title={sermon.title as string}
          metaLine={metaLine}
          backHref="/projection"
          backLabel="Projection"
          startHref={`/projection?kind=message&slug=${encodeURIComponent(sermon.slug as string)}`}
          initialIndex={resolveStartIndex(rows, paragraph)}
          units={rows.map((p) => ({
            id: String(p.number),
            label: `Paragraphe ${p.number}`,
            text: p.text,
          }))}
        />
      );
    }
  }

  if (supabase && kind === "hymn" && sp.hymn) {
    const { data: hymn } = await supabase
      .from("hymns")
      .select("slug, title, number, category, lyrics, verses, chorus, validation_status, hymn_books ( name )")
      .eq("slug", sp.hymn)
      .eq("is_published", true)
      .maybeSingle();

    if (hymn?.lyrics) {
      const verses = Array.isArray(hymn.verses)
        ? hymn.verses.map(hymnVerseText).filter(Boolean)
        : [];
      const chorus = typeof hymn.chorus === "string" && hymn.chorus.trim() ? hymn.chorus.trim() : null;
      const structureIsValid = hymn.validation_status !== "needs_review";
      const units =
        structureIsValid && verses.length > 0
          ? verses.flatMap((verse, index) => {
              const out = [{ id: `v-${index + 1}`, label: `Couplet ${index + 1}`, text: verse }];
              if (chorus) out.push({ id: `c-${index + 1}`, label: "Refrain", text: chorus });
              return out;
            })
          : [
              {
                id: hymn.slug as string,
                label: hymn.number ? `Cantique ${hymn.number}` : "Cantique",
                text: hymn.lyrics as string,
              },
            ];
      const hymnBook = Array.isArray(hymn.hymn_books) ? hymn.hymn_books[0] : hymn.hymn_books;
      return (
        <ProjectionReader
          title={hymn.title as string}
          metaLine={[hymnBook?.name, hymn.number, hymn.category].filter(Boolean).join(" · ")}
          backHref="/projection?kind=hymn"
          backLabel="Projection"
          startHref={`/projection?kind=hymn&hymn=${encodeURIComponent(hymn.slug as string)}`}
          units={units}
        />
      );
    }
  }

  let sermons: {
    slug: string;
    title: string;
    year: number | null;
    preached_on: string | null;
    location: string | null;
  }[] = [];
  let hymns: {
    slug: string;
    title: string;
    number: string | null;
    category: string | null;
    book_id: string | null;
    hymn_books?: { name?: string | null } | { name?: string | null }[] | null;
  }[] = [];
  let hymnBooks: { id: string; name: string; slug: string }[] = [];
  let bibleRows: {
    book: string;
    chapter: number;
    verse: number;
    text: string;
  }[] = [];

  if (supabase) {
    let sermonQuery = supabase
      .from("sermons")
      .select("slug, title, year, preached_on, location")
      .eq("is_published", true)
      .limit(18);
    if (q) sermonQuery = sermonQuery.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
    if (year) sermonQuery = sermonQuery.eq("year", year);
    if (place) sermonQuery = sermonQuery.ilike("location", `%${place.replace(/[%_]/g, "")}%`);
    const { data: sermonData } = await sermonQuery.order("preached_on", {
      ascending: true,
      nullsFirst: false,
    });
    sermons = (sermonData ?? []) as typeof sermons;

    const { data: bookData } = await supabase
      .from("hymn_books")
      .select("id, name, slug")
      .eq("is_published", true)
      .order("name", { ascending: true });
    hymnBooks = (bookData ?? []) as typeof hymnBooks;

    let hymnQuery = supabase
      .from("hymns")
      .select("slug, title, number, category, book_id, hymn_books ( name )")
      .eq("is_published", true)
      .limit(18);
    const selectedHymnBook = clean(sp.book);
    if (selectedHymnBook) hymnQuery = hymnQuery.eq("book_id", selectedHymnBook);
    if (q) {
      const qSafe = q.replace(/[%_,]/g, "");
      const bestTerm =
        qSafe
          .split(/\s+/)
          .map((term) => term.trim())
          .filter((term) => term.length >= 3)
          .sort((a, b) => b.length - a.length)[0] ?? qSafe;
      hymnQuery = hymnQuery.or(
        `title.ilike.%${qSafe}%,number.ilike.%${qSafe}%,lyrics.ilike.%${qSafe}%,title.ilike.%${bestTerm}%,lyrics.ilike.%${bestTerm}%`,
      );
    }
    const { data: hymnData } = await hymnQuery.order("number", { ascending: true });
    hymns = (hymnData ?? []) as typeof hymns;

    const book = clean(sp.book);
    const chapter = parsePositiveInt(sp.chapter);
    if (book && chapter) {
      const { data: verses } = await supabase
        .from("bible_passages")
        .select("book, chapter, verse, text")
        .eq("book", book)
        .eq("chapter", chapter)
        .order("verse", { ascending: true })
        .limit(80);
      bibleRows = (verses ?? []) as typeof bibleRows;
    }
  }

  if (kind === "bible" && sp.book && sp.chapter && sp.project === "1" && bibleRows.length > 0) {
    const title = `${bibleRows[0]!.book} ${bibleRows[0]!.chapter}`;
    return (
      <ProjectionReader
        title={title}
        metaLine="Bible"
        backHref={`/projection?kind=bible&book=${encodeURIComponent(sp.book)}&chapter=${encodeURIComponent(sp.chapter)}`}
        backLabel="Projection"
        startHref={`/projection?kind=bible&book=${encodeURIComponent(sp.book)}&chapter=${encodeURIComponent(sp.chapter)}&project=1`}
        units={bibleRows.map((v) => ({
          id: `${v.book}-${v.chapter}-${v.verse}`,
          label: `${v.book} ${v.chapter}:${v.verse}`,
          text: v.text,
        }))}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
              Projection
            </p>
            <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
              Bibliotheques separees
            </h1>
          </div>
          <Link
            href="/sermons"
            className="text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
          >
            Ouvrir la bibliotheque Message
          </Link>
        </div>

        <nav className="mt-8 flex flex-wrap gap-2">
          {[
            ["message", "Message"],
            ["bible", "Bible"],
            ["hymn", "Cantiques"],
          ].map(([value, label]) => (
            <Link
              key={value}
              href={`/projection?kind=${value}`}
              className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                kind === value
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {kind === "message" ? (
          <section className="mt-8">
            <form className="moboko-card grid gap-4 p-5 md:grid-cols-[1.4fr_0.7fr_0.9fr_auto]">
              <input type="hidden" name="kind" value="message" />
              <label className="text-sm font-medium text-[var(--foreground)]">
                Titre du sermon
                <input
                  name="q"
                  defaultValue={q}
                  list="projection-sermons"
                  className="moboko-input mt-2"
                  placeholder="Ex. La Semence du serpent"
                />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                Annee
                <input name="year" defaultValue={sp.year ?? ""} className="moboko-input mt-2" inputMode="numeric" />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                Lieu
                <input name="place" defaultValue={place} className="moboko-input mt-2" />
              </label>
              <button className="moboko-btn-primary self-end px-5 py-3 text-sm">Chercher</button>
            </form>
            <datalist id="projection-sermons">
              {sermons.map((s) => (
                <option key={s.slug} value={s.title} />
              ))}
            </datalist>
            <div className="mt-5 grid gap-3">
              {sermons.map((s) => (
                <article key={s.slug} className="moboko-card grid gap-4 p-4 md:grid-cols-[1fr_auto]">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">{s.title}</h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {[s.preached_on, s.year, s.location].filter(Boolean).join(" Â· ")}
                    </p>
                  </div>
                  <form className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="kind" value="message" />
                    <input type="hidden" name="slug" value={s.slug} />
                    <label className="text-xs font-medium text-[var(--muted)]">
                      Paragraphe
                      <input name="p" className="moboko-input mt-1 w-28 py-2 text-sm" inputMode="numeric" />
                    </label>
                    <button className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]">
                      Projeter
                    </button>
                  </form>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {kind === "bible" ? (
          <section className="mt-8">
            <form className="moboko-card grid gap-4 p-5 md:grid-cols-[1fr_0.7fr_auto]">
              <input type="hidden" name="kind" value="bible" />
              <label className="text-sm font-medium text-[var(--foreground)]">
                Livre
                <input name="book" defaultValue={sp.book ?? ""} className="moboko-input mt-2" placeholder="Jean" />
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                Chapitre
                <input name="chapter" defaultValue={sp.chapter ?? ""} className="moboko-input mt-2" inputMode="numeric" />
              </label>
              <button className="moboko-btn-primary self-end px-5 py-3 text-sm">Chercher</button>
            </form>
            <div className="mt-5 grid gap-3">
              {bibleRows.length > 0 ? (
                <Link
                  href={`/projection?kind=bible&book=${encodeURIComponent(sp.book ?? "")}&chapter=${encodeURIComponent(sp.chapter ?? "")}&project=1`}
                  className="moboko-btn-primary w-fit px-5 py-3 text-sm"
                >
                  Projeter ce chapitre
                </Link>
              ) : null}
              {bibleRows.map((v) => (
                <article key={`${v.book}-${v.chapter}-${v.verse}`} className="moboko-card p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                    {v.book} {v.chapter}:{v.verse}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">{v.text}</p>
                </article>
              ))}
              {sp.book && bibleRows.length === 0 ? (
                <p className="moboko-card p-6 text-sm text-[var(--muted)]">
                  Aucun passage biblique charge pour cette reference.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {kind === "hymn" ? (
          <section className="mt-8">
            <form className="moboko-card grid gap-4 p-5 md:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="kind" value="hymn" />
              <label className="text-sm font-medium text-[var(--foreground)]">
                Livre
                <select name="book" defaultValue={sp.book ?? ""} className="moboko-input mt-2">
                  <option value="">Tous les livres</option>
                  {hymnBooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--foreground)]">
                Titre ou numero
                <input name="q" defaultValue={q} list="projection-hymns" className="moboko-input mt-2" />
              </label>
              <button className="moboko-btn-primary self-end px-5 py-3 text-sm">Chercher</button>
            </form>
            <datalist id="projection-hymns">
              {hymns.map((h) => (
                <option key={h.slug} value={h.number ? `${h.number} ${h.title}` : h.title} />
              ))}
            </datalist>
            <div className="mt-5 grid gap-3">
              {hymns.map((h) => (
                <article key={h.slug} className="moboko-card flex flex-wrap items-center justify-between gap-4 p-4">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">{h.title}</h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {[
                        Array.isArray(h.hymn_books) ? h.hymn_books[0]?.name : h.hymn_books?.name,
                        h.number,
                        h.category,
                      ].filter(Boolean).join(" Â· ")}
                    </p>
                  </div>
                  <Link
                    href={`/projection?kind=hymn&hymn=${encodeURIComponent(h.slug)}`}
                    className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]"
                  >
                    Projeter
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
