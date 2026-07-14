import { Masthead } from "@/components/layout/Masthead";
import { displayHymnNumber } from "@/lib/library/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ bookSlug: string; number: string }>;
};

type VerseValue = string | { number?: number; text?: string };

function verseText(value: VerseValue) {
  if (typeof value === "string") return value;
  return typeof value?.text === "string" ? value.text : "";
}

function sortNumber(value: string | null) {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  const conflict = value.match(/-conflit-(\d+)$/);
  return (Number.isFinite(n) ? n : 0) * 100 + (conflict ? Number(conflict[1]) : 0);
}

export default async function HymnReadPage({ params }: Props) {
  const { bookSlug, number } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) notFound();

  const { data: book } = await supabase
    .from("hymn_books")
    .select("id, name, slug")
    .eq("slug", decodeURIComponent(bookSlug))
    .eq("is_published", true)
    .maybeSingle();
  if (!book?.id) notFound();

  const wantedNumber = decodeURIComponent(number);
  const { data: hymn } = await supabase
    .from("hymns")
    .select("slug, title, number, lyrics, verses, chorus, key_signature, validation_status")
    .eq("book_id", book.id)
    .eq("number", wantedNumber)
    .eq("is_published", true)
    .maybeSingle();
  if (!hymn?.slug) notFound();

  const { data: siblings } = await supabase
    .from("hymns")
    .select("number, title")
    .eq("book_id", book.id)
    .eq("is_published", true)
    .limit(1000);
  const ordered = [...(siblings ?? [])].sort((a, b) => sortNumber(a.number as string | null) - sortNumber(b.number as string | null));
  const index = ordered.findIndex((row) => row.number === hymn.number);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const verses = Array.isArray(hymn.verses)
    ? (hymn.verses as VerseValue[]).map(verseText).filter(Boolean)
    : [];
  const structureIsValid = hymn.validation_status !== "needs_review";

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <Link href={`/hymns?book=${encodeURIComponent(book.id as string)}`} className="text-sm font-medium text-[var(--accent)] hover:underline">
          Retour au livre
        </Link>
        <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">{book.name as string}</p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">{hymn.title as string}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Cantique {displayHymnNumber(hymn.number as string | null)}
          {hymn.key_signature ? ` · Tonalite ${hymn.key_signature}` : ""}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/projection?kind=hymn&hymn=${encodeURIComponent(hymn.slug as string)}`} className="moboko-btn-primary px-5 py-3 text-sm">
            Projeter
          </Link>
          {prev?.number ? (
            <Link href={`/hymns/${book.slug}/${encodeURIComponent(prev.number as string)}`} className="rounded-full border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]">
              Precedent
            </Link>
          ) : null}
          {next?.number ? (
            <Link href={`/hymns/${book.slug}/${encodeURIComponent(next.number as string)}`} className="rounded-full border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]">
              Suivant
            </Link>
          ) : null}
        </div>

        <section className="mt-8 space-y-4">
          {!structureIsValid ? (
            <article className="moboko-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">Texte complet</p>
              <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-[var(--foreground)]">{hymn.lyrics as string}</p>
            </article>
          ) : verses.length > 0 ? (
            verses.map((verse, i) => (
              <article key={i} className="moboko-card p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">Couplet {i + 1}</p>
                <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-[var(--foreground)]">{verse}</p>
              </article>
            ))
          ) : (
            <article className="moboko-card p-5">
              <p className="whitespace-pre-wrap text-base leading-relaxed text-[var(--foreground)]">{hymn.lyrics as string}</p>
            </article>
          )}
          {structureIsValid && hymn.chorus ? (
            <article className="moboko-card border-[var(--accent)]/30 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">Refrain</p>
              <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-[var(--foreground)]">{hymn.chorus as string}</p>
            </article>
          ) : null}
        </section>
      </main>
    </div>
  );
}
