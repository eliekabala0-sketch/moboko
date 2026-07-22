import { ProjectionReader } from "@/components/projection/ProjectionReader";
import { buildSermonProjectionUnits } from "@/lib/sermons/projection-segments";

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
  const units = buildSermonProjectionUnits(paragraphs);
  const initialParagraph = paragraphs[initialIndex]?.paragraph_number;
  const segmentedInitialIndex = initialParagraph
    ? Math.max(0, units.findIndex((unit) => unit.paragraphNumber === initialParagraph))
    : 0;
  return (
    <ProjectionReader
      title={sermonTitle}
      metaLine={metaLine}
      backHref={`/sermons/${encodeURIComponent(slug)}`}
      backLabel="Lecture"
      startHref={`/sermons/${encodeURIComponent(slug)}/project`}
      initialIndex={segmentedInitialIndex}
      units={units}
    />
  );
}
