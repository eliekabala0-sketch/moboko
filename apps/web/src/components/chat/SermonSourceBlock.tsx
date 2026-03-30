"use client";

import Link from "next/link";

type Props = {
  title: string;
  slug: string;
  location: string | null;
  date: string | null;
  paragraphNumber: number;
  paragraphText: string;
};

export function SermonSourceBlock({
  title,
  slug,
  location,
  date,
  paragraphNumber,
  paragraphText,
}: Props) {
  const slugEnc = encodeURIComponent(slug);
  const readHref = `/sermons/${slugEnc}#p-${paragraphNumber}`;
  const projectHref = `/sermons/${slugEnc}/project?p=${paragraphNumber}`;

  return (
    <article className="moboko-card p-5 sm:p-6">
      <p className="font-medium text-[var(--foreground)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--accent)]">
        §{paragraphNumber}
        {location ? ` · ${location}` : ""}
        {date ? ` · ${date}` : ""}
      </p>
      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--foreground)]">
        {paragraphText}
      </p>
      <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
        <Link href={readHref} className="text-[var(--accent)] hover:underline">
          Lire
        </Link>
        <Link href={projectHref} className="text-[var(--foreground)] hover:underline">
          Projeter
        </Link>
      </div>
    </article>
  );
}

