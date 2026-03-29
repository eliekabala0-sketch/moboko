import Image from "next/image";
import type { PublicHomePageSettings } from "@moboko/shared";

type Props = {
  settings: PublicHomePageSettings;
};

export function HomeHeroSection({ settings }: Props) {
  const url = settings.homeHeroImageUrl?.trim();
  const title =
    settings.homeHeroTitle?.trim() || "Une présence calme pour avancer avec clarté";
  const subtitle =
    settings.homeHeroSubtitle?.trim() || "Chemin intérieur";

  return (
    <section
      className="relative aspect-[21/9] min-h-[240px] w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-[var(--border-strong)] shadow-[0_32px_80px_-28px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.06)]"
      aria-label="En-tête visuel"
    >
      {url ? (
        <Image
          src={url}
          alt={title}
          fill
          priority
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 1024px"
        />
      ) : (
        <div
          className="absolute inset-0 bg-gradient-to-br from-[#1a2744] via-[#12192b] to-[#0c1528]"
          aria-hidden
        />
      )}
      <div
        className="absolute inset-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/55 to-transparent"
        aria-hidden
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--background)]/40 via-transparent to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-8 sm:p-11">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]/90">
          {subtitle}
        </p>
        <h2 className="font-display mt-3 max-w-xl text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-[1.75rem] sm:leading-snug">
          {title}
        </h2>
      </div>
    </section>
  );
}
