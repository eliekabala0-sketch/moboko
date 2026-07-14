import { HomeHeroSection } from "@/components/home/HomeHeroSection";
import { Masthead } from "@/components/layout/Masthead";
import { fetchPublishedAppearance } from "@/lib/appearance/data";
import { fetchPublicAppSettings } from "@/lib/data/public-app-settings";
import Link from "next/link";
import type { CSSProperties } from "react";

function splitHighlightedTitle(title: string, highlight: string) {
  const needle = highlight.trim();
  if (!needle) return { before: title, highlighted: "", after: "" };
  const index = title.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return { before: title, highlighted: "", after: "" };
  return {
    before: title.slice(0, index),
    highlighted: title.slice(index, index + needle.length),
    after: title.slice(index + needle.length),
  };
}

export default async function Home() {
  const settings = await fetchPublicAppSettings();
  const appearance = await fetchPublishedAppearance();
  const home = appearance.pages.home;
  const blocks = appearance.blocks.filter((block) => block.enabled).sort((a, b) => a.order - b.order);
  const { before, highlighted, after } = splitHighlightedTitle(home.title, home.highlight);
  const focalPosition = `${appearance.images.focalX}% ${appearance.images.focalY}%`;
  const mainStyle = {
    "--accent": appearance.colors.accent,
    "--primary": appearance.colors.primary,
    backgroundImage: appearance.images.backgroundImageUrl
      ? `linear-gradient(rgba(8, 11, 18, 0.88), rgba(8, 11, 18, 0.94)), url(${appearance.images.backgroundImageUrl})`
      : undefined,
    backgroundSize: "cover",
    backgroundPosition: focalPosition,
  } as CSSProperties;

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-6 py-16 sm:py-20" style={mainStyle}>
        {blocks.map((block) =>
          block.id === "intro" ? (
            <div key={block.id} className="relative max-w-2xl space-y-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
                {home.eyebrow}
              </p>
              <h1 className="font-display text-4xl font-semibold leading-[1.12] tracking-tight text-[var(--foreground)] sm:text-5xl sm:leading-[1.08]">
                {before}
                {highlighted ? (
                  <span className="bg-gradient-to-r from-[var(--accent)] to-[#e4d4a8] bg-clip-text text-transparent">
                    {highlighted}
                  </span>
                ) : null}
                {after}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-[var(--muted)]">{home.lead}</p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link
                  href={home.primaryHref}
                  className="moboko-btn-primary inline-flex items-center justify-center px-7 py-3 text-[15px]"
                >
                  {home.primaryButton}
                </Link>
                <Link
                  href={home.secondaryHref}
                  className="inline-flex items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)]/60 px-6 py-3 text-[15px] font-medium text-[var(--foreground)] backdrop-blur-sm transition hover:border-[var(--accent)]/35 hover:bg-[var(--surface-elevated)]"
                >
                  {home.secondaryButton}
                </Link>
              </div>
            </div>
          ) : (
            <HomeHeroSection key={block.id} settings={settings} appearance={appearance} />
          ),
        )}
      </main>
    </div>
  );
}
