import { ProjectionReader } from "@/components/projection/ProjectionReader";

export type ProjectionParagraph = {
  paragraph_number: number;
  paragraph_text: string;
};

type Props = {
  slug: string;
  sermonTitle: string;
  metaLine: string;
  paragraphs: ProjectionParagraph[];
  initialIndex: number;
};

export function SermonProjectionView({
  slug,
  sermonTitle,
  metaLine,
  paragraphs,
  initialIndex,
}: Props) {
  return (
    <ProjectionReader
      title={sermonTitle}
      metaLine={metaLine}
      backHref={`/sermons/${encodeURIComponent(slug)}`}
      backLabel="Lecture"
      startHref={`/sermons/${encodeURIComponent(slug)}/project`}
      initialIndex={initialIndex}
      units={paragraphs.map((p) => ({
        id: String(p.paragraph_number),
        label: `Paragraphe ${p.paragraph_number}`,
        text: p.paragraph_text,
      }))}
    />
  );
}
