import { Masthead } from "@/components/layout/Masthead";

export const metadata = { title: "Mes telechargements | Moboko" };

export default function DownloadsPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Audio</p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Mes telechargements
        </h1>
        <div className="moboko-card mt-8 p-6 text-sm leading-relaxed text-[var(--muted)]">
          Les audios hors connexion seront stockes uniquement apres action explicite depuis Moboko. Cette page recevra la gestion fine de l&apos;espace utilise, la verification des droits et la suppression locale pendant l&apos;import pilote.
        </div>
      </main>
    </div>
  );
}
