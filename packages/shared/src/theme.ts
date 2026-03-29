/**
 * Jetons de design Moboko — aligner web (CSS variables / Tailwind) et mobile (StyleSheet).
 * Direction : fond sombre maîtrisé, accents or doux et bleu profond, lisibilité premium.
 */
export const mobokoTheme = {
  colors: {
    background: "#080B12",
    backgroundElevated: "#0C1220",
    surface: "#12192B",
    surfaceElevated: "#1A2338",
    primary: "#5B7FC8",
    primarySoft: "rgba(91, 127, 200, 0.18)",
    primaryMuted: "#2A3650",
    accent: "#C9A962",
    accentMuted: "rgba(201, 169, 98, 0.25)",
    text: "#E8ECF4",
    textMuted: "#8B95A8",
    border: "rgba(255, 255, 255, 0.09)",
    borderStrong: "rgba(201, 169, 98, 0.22)",
    success: "#6BCEA0",
    warning: "#D4A574",
    danger: "#E07878",
    chatUser: "#2A3D5E",
    chatAssistant: "#151C2E",
    overlay: "rgba(8, 11, 18, 0.92)",
  },
  radii: {
    sm: 8,
    md: 14,
    lg: 22,
    full: 9999,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  font: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
} as const;

export type MobokoTheme = typeof mobokoTheme;
