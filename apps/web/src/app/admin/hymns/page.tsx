import { createHymnAction, deleteHymnAction, importHymnBookAction, updateHymnAction } from "@/app/admin/hymns/actions";
import { requireAdmin } from "@/lib/admin/require-admin";

export const metadata = {
  title: "Cantiques | Admin Moboko",
};

export default async function AdminHymnsPage() {
  const { supabase } = await requireAdmin();
  const { data: hymns } = await supabase
    .from("hymns")
    .select("id, title, slug, number, category, lyrics, is_published, book_id, hymn_books ( name )")
    .order("number", { ascending: true });
  const { data: books } = await supabase
    .from("hymn_books")
    .select("id, name, slug, is_published")
    .order("name", { ascending: true });

  return (
    <main>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Admin
      </p>
      <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
        Cantiques
      </h1>

      <form action={importHymnBookAction} className="moboko-card mt-8 grid gap-4 p-5">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Importer un livre complet</h2>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Nom du livre
            <input name="book_name" required className="moboko-input mt-2" placeholder="Ex. Cantiques de la Foi" />
          </label>
          <label className="text-sm font-medium text-[var(--foreground)]">
            Description
            <input name="description" className="moboko-input mt-2" />
          </label>
        </div>
        <label className="text-sm font-medium text-[var(--foreground)]">
          Texte du livre
          <textarea
            name="book_text"
            required
            rows={14}
            className="moboko-input mt-2 resize-y"
            placeholder={"1 Titre du cantique\nPremier couplet...\n\nRefrain: ...\n\n2 Autre cantique\n..."}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
          <input name="is_published" type="checkbox" defaultChecked className="h-4 w-4" />
          Publier le livre et les cantiques importes
        </label>
        <button className="moboko-btn-primary w-fit px-6 py-3 text-sm">Importer le livre</button>
      </form>

      <form action={createHymnAction} className="moboko-card mt-8 grid gap-4 p-5">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Ajouter un cantique</h2>
        <div className="grid gap-4 md:grid-cols-[0.5fr_1fr_1fr_1fr]">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Numero
            <input name="number" className="moboko-input mt-2" />
          </label>
          <label className="text-sm font-medium text-[var(--foreground)]">
            Titre
            <input name="title" required className="moboko-input mt-2" />
          </label>
          <label className="text-sm font-medium text-[var(--foreground)]">
            Categorie
            <input name="category" className="moboko-input mt-2" />
          </label>
          <label className="text-sm font-medium text-[var(--foreground)]">
            Livre
            <select name="book_id" className="moboko-input mt-2">
              <option value="">Sans livre</option>
              {(books ?? []).map((book) => (
                <option key={book.id} value={book.id as string}>
                  {book.name as string}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="text-sm font-medium text-[var(--foreground)]">
          Texte exact
          <textarea name="lyrics" required rows={8} className="moboko-input mt-2 resize-y" />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
          <input name="is_published" type="checkbox" defaultChecked className="h-4 w-4" />
          Publie
        </label>
        <button className="moboko-btn-primary w-fit px-6 py-3 text-sm">Ajouter</button>
      </form>

      <section className="mt-10 space-y-4">
        {(hymns ?? []).map((hymn) => (
          <article key={hymn.id} className="moboko-card p-5">
            <form action={updateHymnAction} className="grid gap-4">
              <input type="hidden" name="id" value={hymn.id as string} />
              <div className="grid gap-4 md:grid-cols-[0.5fr_1fr_1fr_1fr]">
                <label className="text-sm font-medium text-[var(--foreground)]">
                  Numero
                  <input name="number" defaultValue={(hymn.number as string | null) ?? ""} className="moboko-input mt-2" />
                </label>
                <label className="text-sm font-medium text-[var(--foreground)]">
                  Titre
                  <input name="title" required defaultValue={hymn.title as string} className="moboko-input mt-2" />
                </label>
                <label className="text-sm font-medium text-[var(--foreground)]">
                  Categorie
                  <input name="category" defaultValue={(hymn.category as string | null) ?? ""} className="moboko-input mt-2" />
                </label>
                <label className="text-sm font-medium text-[var(--foreground)]">
                  Livre
                  <select name="book_id" defaultValue={(hymn.book_id as string | null) ?? ""} className="moboko-input mt-2">
                    <option value="">Sans livre</option>
                    {(books ?? []).map((book) => (
                      <option key={book.id} value={book.id as string}>
                        {book.name as string}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="text-sm font-medium text-[var(--foreground)]">
                Texte exact
                <textarea
                  name="lyrics"
                  required
                  rows={7}
                  defaultValue={hymn.lyrics as string}
                  className="moboko-input mt-2 resize-y"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                  <input
                    name="is_published"
                    type="checkbox"
                    defaultChecked={Boolean(hymn.is_published)}
                    className="h-4 w-4"
                  />
                  Publie
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-full border border-[var(--border-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)]">
                    Enregistrer
                  </button>
                </div>
              </div>
            </form>
            <form action={deleteHymnAction} className="mt-3">
              <input type="hidden" name="id" value={hymn.id as string} />
              <button className="text-sm font-semibold text-[var(--danger)]">Supprimer</button>
            </form>
          </article>
        ))}
        {(hymns ?? []).length === 0 ? (
          <p className="moboko-card p-6 text-sm text-[var(--muted)]">Aucun cantique pour le moment.</p>
        ) : null}
      </section>
    </main>
  );
}
