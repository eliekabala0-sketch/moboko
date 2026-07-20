import { AudioLibraryClient } from "@/components/audio/AudioLibraryClient";
import { Masthead } from "@/components/layout/Masthead";
import Link from "next/link";

export const metadata = { title: "Lignes de priere | Moboko" };

export default function PrayerLinesAudioPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <Link href="/audio" className="text-sm font-medium text-[var(--accent)] hover:underline">Retour audio</Link>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Audio</p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">Lignes de priere</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Ces audios restent separes des recherches doctrinales et de l&apos;Assistant.
        </p>
        <AudioLibraryClient category="prayer_line" />
      </main>
    </div>
  );
}
