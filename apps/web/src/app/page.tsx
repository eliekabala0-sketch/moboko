import { HomeHeroSection } from "@/components/home/HomeHeroSection";
import { Masthead } from "@/components/layout/Masthead";
import { fetchPublicAppSettings } from "@/lib/data/public-app-settings";
import Link from "next/link";

export default async function Home() {
  const settings = await fetchPublicAppSettings();

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-6 py-16 sm:py-20">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-40"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(201, 169, 98, 0.08), transparent 65%)",
          }}
        />
        <div className="relative max-w-2xl space-y-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
            Moboko
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.12] tracking-tight text-[var(--foreground)] sm:text-5xl sm:leading-[1.08]">
            Votre compagnon spirituel,{" "}
            <span className="bg-gradient-to-r from-[var(--accent)] to-[#e4d4a8] bg-clip-text text-transparent">
              clair et respectueux
            </span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-[var(--muted)]">
            Posez vos questions, explorez les enseignements, et vivez les temps forts en direct grâce
            à l’assistant — une interface pensée pour la sérénité et la lisibilité.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/auth"
              className="moboko-btn-primary inline-flex items-center justify-center px-7 py-3 text-[15px]"
            >
              Commencer
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)]/60 px-6 py-3 text-[15px] font-medium text-[var(--foreground)] backdrop-blur-sm transition hover:border-[var(--accent)]/35 hover:bg-[var(--surface-elevated)]"
            >
              Assistant
            </Link>
          </div>
        </div>

        <HomeHeroSection settings={settings} />
      </main>
    </div>
  );
}
