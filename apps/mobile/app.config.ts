import type { ConfigContext, ExpoConfig } from "expo/config";

const MOBOKO_SITE_URL_PRODUCTION = "https://moboko-production.up.railway.app";

export default ({ config }: ConfigContext): ExpoConfig => {
  const fromEnv = (k: string) =>
    process.env[k]?.trim()?.replace(/\/$/, "") ?? "";

  const apiBase = fromEnv("EXPO_PUBLIC_API_BASE_URL") || MOBOKO_SITE_URL_PRODUCTION;
  const siteUrl = fromEnv("EXPO_PUBLIC_SITE_URL") || MOBOKO_SITE_URL_PRODUCTION;

  const prevExtra =
    typeof config.extra === "object" && config.extra !== null
      ? (config.extra as Record<string, unknown>)
      : {};

  return {
    ...config,
    name: config.name ?? "Moboko",
    slug: config.slug ?? "moboko",
    scheme: "moboko",
    extra: {
      ...prevExtra,
      apiBaseUrl: apiBase,
      siteUrl,
    },
  } satisfies ExpoConfig;
};
