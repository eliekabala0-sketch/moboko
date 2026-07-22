export type ProjectionSourceParagraph = {
  paragraph_number: number;
  paragraph_text: string;
};

export type SermonProjectionUnit = {
  id: string;
  label: string;
  text: string;
  paragraphNumber: number;
  segment: number;
  segmentCount: number;
};

function splitLongBlock(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  const sentences = block.split(/(?<=[.!?…»])\s+/u).filter(Boolean);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current && sentence.length > maxChars) {
      let rest = sentence;
      while (rest.length > maxChars) {
        const space = rest.lastIndexOf(" ", maxChars);
        const cut = space > Math.floor(maxChars * 0.55) ? space : maxChars;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trimStart();
      }
      current = rest;
      continue;
    }
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxChars && current) {
      parts.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function buildSermonProjectionUnits(
  paragraphs: ProjectionSourceParagraph[],
  maxChars = 900,
): SermonProjectionUnit[] {
  return paragraphs.flatMap((paragraph) => {
    const blocks = paragraph.paragraph_text
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => splitLongBlock(part, maxChars));
    const segments = blocks.length ? blocks : [paragraph.paragraph_text.trim()];
    return segments.map((text, index) => ({
      id: segments.length === 1 ? String(paragraph.paragraph_number) : `${paragraph.paragraph_number}-${index + 1}`,
      label:
        segments.length === 1
          ? `Paragraphe ${paragraph.paragraph_number}`
          : `Paragraphe ${paragraph.paragraph_number} — segment ${index + 1}/${segments.length}`,
      text,
      paragraphNumber: paragraph.paragraph_number,
      segment: index + 1,
      segmentCount: segments.length,
    }));
  });
}
