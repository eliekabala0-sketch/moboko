export function displayHymnNumber(number: string | null | undefined) {
  if (!number) return "";
  return number.replace(/-conflit-(\d+)$/i, (_, rank) => {
    const n = Number(rank);
    if (n === 2) return " bis";
    if (n === 3) return " ter";
    return ` variante ${n}`;
  });
}

export function sanitizeLike(value: string) {
  return value.replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
}

export function significantTerms(value: string) {
  return sanitizeLike(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .sort((a, b) => b.length - a.length);
}

export function parsePositiveInt(value: string | undefined | null) {
  const n = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
