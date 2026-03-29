import { Masthead } from "@/components/layout/Masthead";

export default function PostsPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <div className="mx-auto max-w-2xl flex-1 px-6 py-20 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Contenu
        </p>
        <h1 className="font-display mt-3 text-2xl font-semibold text-[var(--foreground)] sm:text-3xl">
          Enseignements
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
          Liste des publications spirituelles publiées par l’administrateur — prochaine étape.
        </p>
      </div>
    </div>
  );
}
