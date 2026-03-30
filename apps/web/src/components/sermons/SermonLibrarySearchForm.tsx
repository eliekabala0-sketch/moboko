import Link from "next/link";

type Props = {
  st: string;
  sy: string;
  sl: string;
  pq: string;
};

export function SermonLibrarySearchForm({ st, sy, sl, pq }: Props) {
  return (
    <form
      id="filtres-sermons"
      className="moboko-card mt-8 space-y-6 p-6 sm:p-7"
      action="/sermons"
      method="get"
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
          Filtrer les sermons
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium text-[var(--foreground)]">
            <span className="text-[var(--muted)]">Titre contient</span>
            <input
              name="st"
              type="search"
              defaultValue={st}
              placeholder="Ex. guérison"
              className="moboko-input mt-2"
              autoComplete="off"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--foreground)]">
            <span className="text-[var(--muted)]">Année</span>
            <input
              name="sy"
              type="number"
              inputMode="numeric"
              defaultValue={sy}
              placeholder="1963"
              className="moboko-input mt-2"
              min={1900}
              max={2100}
            />
          </label>
          <label className="block text-sm font-medium text-[var(--foreground)]">
            <span className="text-[var(--muted)]">Lieu contient</span>
            <input
              name="sl"
              type="search"
              defaultValue={sl}
              placeholder="Ex. Phoenix"
              className="moboko-input mt-2"
              autoComplete="off"
            />
          </label>
        </div>
      </div>

      <div className="border-t border-[var(--border)] pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
          Recherche dans le texte
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Mots ou expressions (full-text français sur les paragraphes). Les résultats ouvrent le sermon sur le
          paragraphe concerné.
        </p>
        <label className="mt-3 block text-sm font-medium text-[var(--foreground)]">
          <span className="text-[var(--muted)]">Mot ou expression</span>
          <input
            name="pq"
            type="search"
            defaultValue={pq}
            placeholder='Ex. foi — ou "Saint-Esprit"'
            className="moboko-input mt-2"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="moboko-btn-primary px-6 py-3 text-[14px]">
          Rechercher
        </button>
        <Link
          href="/sermons"
          className="inline-flex items-center rounded-full border border-[var(--border)] px-6 py-3 text-[14px] font-semibold text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
        >
          Réinitialiser
        </Link>
      </div>
    </form>
  );
}
