import { importBibleAction } from "@/app/admin/bible/actions";
import { requireAdmin } from "@/lib/admin/require-admin";

export const metadata = {
  title: "Bible | Admin Moboko",
};

export default async function AdminBiblePage() {
  const { supabase } = await requireAdmin();
  const { data: rows, count, error } = await supabase
    .from("bible_passages")
    .select("translation, book, chapter", { count: "exact" })
    .order("translation", { ascending: true })
    .limit(40000);
  const versionMap = new Map<string, { translation: string; verses: number; books: Set<string>; chapters: Set<string> }>();
  for (const row of rows ?? []) {
    const translation = String(row.translation ?? "LSG");
    const current = versionMap.get(translation) ?? {
      translation,
      verses: 0,
      books: new Set<string>(),
      chapters: new Set<string>(),
    };
    current.verses += 1;
    if (row.book) current.books.add(String(row.book));
    if (row.book && row.chapter) current.chapters.add(`${row.book}.${row.chapter}`);
    versionMap.set(translation, current);
  }
  const versions = Array.from(versionMap.values()).map((version) => ({
    translation: version.translation,
    verses: version.verses,
    books: version.books.size,
    chapters: version.chapters.size,
    scope: version.books.size === 66 && version.chapters.size >= 1189 ? "complete" : "partielle",
  }));

  return (
    <main>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
      <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">Bible</h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        Importez une version biblique structuree pour la lecture et la projection. Les versets sont remplaces par
        reference identique, sans doublon.
      </p>
      {error ? (
        <p className="moboko-card mt-6 border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm text-[var(--foreground)]">
          Une partie des donnees bibliques n&apos;a pas pu etre chargee : {error.message}
        </p>
      ) : null}

      <form action={importBibleAction} className="moboko-card mt-8 grid gap-4 p-5">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Importer une version</h2>
        <label className="text-sm font-medium text-[var(--foreground)]">
          Version
          <input name="translation" required className="moboko-input mt-2" defaultValue="LSG" placeholder="LSG" />
          <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
            Exemple: LSG, KJV, SG21. Cette valeur separe les versions.
          </span>
        </label>
        <label className="text-sm font-medium text-[var(--foreground)]">
          Fichier biblique
          <input name="bible_file" type="file" accept=".json,.csv,.txt,application/json,text/plain,text/csv" className="moboko-input mt-2" />
        </label>
        <label className="text-sm font-medium text-[var(--foreground)]">
          Texte structure ou extrait de verification
          <textarea
            name="bible_text"
            rows={10}
            className="moboko-input mt-2 resize-y"
            placeholder={'JSON: [{"book":"Jean","chapter":3,"verse":16,"text":"..."}]\nCSV: translation,book,chapter,verse,text\nTXT: Jean 3:16 Texte du verset'}
          />
        </label>
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
          Validation minimale: livre, chapitre, verset et texte sont obligatoires. PDF/DOCX doivent etre convertis en
          JSON, CSV ou TXT.
        </p>
        <button className="moboko-btn-primary w-fit px-6 py-3 text-sm">Importer la Bible</button>
      </form>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Versions chargees</h2>
        <div className="moboko-card mt-4 divide-y divide-[var(--border)]">
          {versions.length > 0 ? (
            versions.map((version) => (
              <div key={version.translation} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <p className="font-semibold text-[var(--foreground)]">{version.translation}</p>
                <p className="text-[var(--muted)]">
                  {version.books ?? 0} livres · {version.chapters ?? 0} chapitres · {version.verses ?? 0} versets ·{" "}{version.scope}
                </p>
              </div>
            ))
          ) : (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">Aucune version biblique chargee.</p>
          )}
        </div>
        {count && count > 40000 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Apercu limite a 40000 lignes sur {count} versets. La projection lit la table complete.
          </p>
        ) : null}
      </section>
    </main>
  );
}


