import { AudioLibraryClient } from "@/components/audio/AudioLibraryClient";
import { Masthead } from "@/components/layout/Masthead";
import { audioPublicSelect } from "@/lib/audio/access";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ id: string }> };
type AudioDetail = {
  id: string;
  category: "sermon" | "prayer_line";
  title: string;
  title_original?: string | null;
  original_filename: string | null;
  sermon_date: string | null;
  sermon_year: number | null;
  location: string | null;
  sermons?: { slug?: string | null; title?: string | null } | { slug?: string | null; title?: string | null }[] | null;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: `Audio | ${id} | Moboko` };
}

export default async function AudioDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = createSupabaseServiceClient();
  if (!admin) notFound();
  const { data } = await admin
    .from("audio_items")
    .select(audioPublicSelect())
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  const audio = data as unknown as AudioDetail | null;
  if (!audio) notFound();
  const sermon = Array.isArray(audio.sermons) ? audio.sermons[0] : audio.sermons;
  const titleFr = sermon?.title || audio.title;
  const titleOriginal = audio.title_original || audio.title;

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <Link href="/audio" className="text-sm font-medium text-[var(--accent)] hover:underline">Retour audio</Link>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          {audio.category === "sermon" ? "Sermon audio" : "Ligne de priere"}
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">{titleFr}</h1>
        {titleOriginal !== titleFr ? <p className="mt-2 text-sm text-[var(--muted)]">Titre original : {titleOriginal}</p> : null}
        <p className="mt-3 text-sm text-[var(--muted)]">
          {[audio.sermon_date ?? audio.sermon_year, audio.location, audio.original_filename].filter(Boolean).join(" - ")}
        </p>
        {sermon?.slug ? (
          <Link href={`/sermons/${encodeURIComponent(sermon.slug)}`} className="mt-6 inline-flex rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
            Lire le sermon
          </Link>
        ) : null}
        <AudioLibraryClient category={audio.category as "sermon" | "prayer_line"} focusId={audio.id} />
      </main>
    </div>
  );
}
