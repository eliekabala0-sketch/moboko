import {
  restorePreviousHymnStructureAction,
  saveHymnStructureReviewAction,
} from "@/app/admin/hymns/actions";
import { requireAdmin } from "@/lib/admin/require-admin";
import { displayHymnNumber } from "@/lib/library/format";

export const metadata = {
  title: "Revue des cantiques | Admin Moboko",
};

type Props = {
  searchParams: Promise<{ book?: string; confidence?: string }>;
};

type VerseValue = string | { number?: number; text?: string };
type ProposalBlock = { type?: string; number?: number; text?: string };

function verseText(value: VerseValue) {
  if (typeof value === "string") return value;
  return typeof value?.text === "string" ? value.text : "";
}

function proposalBlocks(value: unknown): ProposalBlock[] {
  if (!value || typeof value !== "object" || !("blocks" in value)) return [];
  const blocks = (value as { blocks?: unknown }).blocks;
  return Array.isArray(blocks) ? (blocks as ProposalBlock[]) : [];
}

function compactJson(value: unknown) {
  if (!value) return "[]";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[]";
  }
}

export default async function AdminHymnReviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data: books } = await supabase
    .from("hymn_books")
    .select("id, name")
    .order("name", { ascending: true });
  let reviewQuery = supabase
    .from("hymns")
    .select(
      "id, title, number, lyrics, full_text, verses, chorus, validation_status, validation_notes, confidence_score, structure_anomalies, structure_proposal, source_mapping, hymn_books ( name, slug )",
    )
    .or("validation_status.eq.needs_review,confidence_score.in.(low,medium,restored)");
  if (sp.book) reviewQuery = reviewQuery.eq("book_id", sp.book);
  if (sp.confidence) reviewQuery = reviewQuery.eq("confidence_score", sp.confidence);
  const { data: hymns, error } = await reviewQuery
    .order("book_id", { ascending: true })
    .order("display_order", { ascending: true })
    .limit(180);

  return (
    <main>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Admin
      </p>
      <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
        Revue des cantiques
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
        Cette page affiche uniquement les chants dont la structure doit etre verifiee. Le texte source reste visible, et
        les couplets se separent avec une ligne contenant uniquement trois tirets.
      </p>

      <form className="moboko-card mt-6 grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="text-sm font-medium text-[var(--foreground)]">
          Livre
          <select name="book" defaultValue={sp.book ?? ""} className="moboko-input mt-2">
            <option value="">Tous</option>
            {(books ?? []).map((book) => (
              <option key={book.id as string} value={book.id as string}>
                {book.name as string}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-[var(--foreground)]">
          Confiance
          <select name="confidence" defaultValue={sp.confidence ?? ""} className="moboko-input mt-2">
            <option value="">Toutes</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="restored">Restored</option>
          </select>
        </label>
        <button className="moboko-btn-primary self-end px-5 py-3 text-sm">Filtrer</button>
      </form>

      {error ? (
        <p className="moboko-card mt-6 border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm text-[var(--foreground)]">
          Impossible de charger la revue : {error.message}
        </p>
      ) : null}

      <section className="mt-8 space-y-5">
        {(hymns ?? []).map((hymn) => {
          const book = Array.isArray(hymn.hymn_books) ? hymn.hymn_books[0] : hymn.hymn_books;
          const verses = Array.isArray(hymn.verses)
            ? (hymn.verses as VerseValue[]).map(verseText).filter(Boolean)
            : [];
          const proposed = proposalBlocks(hymn.structure_proposal);
          const proposedVerses = proposed.filter((block) => block.type === "verse").map((block) => block.text ?? "").filter(Boolean);
          const proposedChorus = proposed.find((block) => block.type === "chorus")?.text ?? "";
          const defaultVerses = (proposedVerses.length ? proposedVerses : verses).join("\n\n---\n\n");
          const defaultChorus = proposedChorus || ((hymn.chorus as string | null) ?? "");
          return (
            <article key={hymn.id as string} className="moboko-card p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                    {book?.name as string | undefined} · Cantique {displayHymnNumber(hymn.number as string | null)}
                  </p>
                  <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--foreground)]">
                    {hymn.title as string}
                  </h2>
                </div>
                <div className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                  {String(hymn.confidence_score ?? "unknown")} · {String(hymn.validation_status ?? "needs_review")}
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <section>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Texte source</h3>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-relaxed text-[var(--foreground)]">
                    {(hymn.full_text as string | null) || (hymn.lyrics as string)}
                  </pre>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Blocs proposes</h3>
                  <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    {proposed.length > 0 ? (
                      proposed.map((block, index) => (
                        <div key={`${block.type}-${index}`} className="mb-4 last:mb-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                            {block.type === "chorus" ? "Refrain" : block.type === "marker" ? "Marqueur" : `Couplet ${block.number ?? index + 1}`}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">
                            {block.text}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--muted)]">Aucun bloc propose.</p>
                    )}
                  </div>
                </section>
              </div>

              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">
                  Anomalies et source
                </summary>
                <pre className="mt-2 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-xs text-[var(--muted)]">
                  {compactJson({
                    validation_notes: hymn.validation_notes,
                    structure_anomalies: hymn.structure_anomalies,
                    source_mapping: hymn.source_mapping,
                  })}
                </pre>
              </details>

              <form action={saveHymnStructureReviewAction} className="mt-5 grid gap-4">
                <input type="hidden" name="id" value={hymn.id as string} />
                <label className="text-sm font-medium text-[var(--foreground)]">
                  Couplets valides
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-[var(--muted)]">
                    Couper avec une ligne &quot;---&quot;, fusionner en supprimant ce separateur, deplacer en changeant l&apos;ordre des blocs.
                  </span>
                  <textarea name="verses_text" rows={12} defaultValue={defaultVerses} className="moboko-input mt-2 resize-y" />
                </label>
                <label className="text-sm font-medium text-[var(--foreground)]">
                  Refrain
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-[var(--muted)]">
                    Definir le refrain ici, ou vider ce champ pour le retirer.
                  </span>
                  <textarea name="chorus" rows={5} defaultValue={defaultChorus} className="moboko-input mt-2 resize-y" />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button className="moboko-btn-primary px-5 py-3 text-sm">Valider la structure</button>
                </div>
              </form>
              <form action={restorePreviousHymnStructureAction} className="mt-3">
                <input type="hidden" name="id" value={hymn.id as string} />
                <button className="text-sm font-semibold text-[var(--danger)]">Restaurer la version precedente</button>
              </form>
            </article>
          );
        })}
        {(hymns ?? []).length === 0 ? (
          <p className="moboko-card p-6 text-sm text-[var(--muted)]">Aucun cantique a verifier.</p>
        ) : null}
      </section>
    </main>
  );
}
