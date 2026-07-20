import { AudioLibraryClient } from "@/components/audio/AudioLibraryClient";
import { Masthead } from "@/components/layout/Masthead";
import Link from "next/link";

export const metadata = {
  title: "Audio | Moboko",
  description: "Mediatheque audio Moboko",
};

export default function AudioPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Audio</p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Mediatheque audio
        </h1>
        <div className="mt-6 flex flex-wrap gap-3 text-sm font-semibold">
          <Link href="/audio/sermons" className="moboko-btn-primary px-4 py-2">Sermons</Link>
          <Link href="/audio/prayer-lines" className="rounded-full border border-[var(--border)] px-4 py-2 text-[var(--muted)] hover:text-[var(--foreground)]">Lignes de priere</Link>
          <Link href="/downloads" className="rounded-full border border-[var(--border)] px-4 py-2 text-[var(--muted)] hover:text-[var(--foreground)]">Mes telechargements</Link>
        </div>
        <AudioLibraryClient />
      </main>
    </div>
  );
}
