export function segmentProjectionText(text: string, targetLength = 620): string[] {
  if (text.length <= targetLength) return [text];

  const out: string[] = [];
  let start = 0;

  while (start < text.length) {
    const remaining = text.length - start;
    if (remaining <= targetLength) {
      out.push(text.slice(start));
      break;
    }

    const limit = start + targetLength;
    let cut = -1;
    for (const marker of [". ", "? ", "! ", "; ", ": ", ", ", "\n"]) {
      const idx = text.lastIndexOf(marker, limit);
      if (idx > start + Math.floor(targetLength * 0.45)) {
        cut = idx + marker.length;
        break;
      }
    }

    if (cut < 0) {
      const space = text.lastIndexOf(" ", limit);
      cut = space > start ? space + 1 : limit;
    }

    out.push(text.slice(start, cut));
    start = cut;
  }

  return out;
}
