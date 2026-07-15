import { MOBOKO_SITE_URL_PRODUCTION } from "@moboko/shared";
import Constants from "expo-constants";

function trimSlash(s: string) {
  return s.replace(/\/$/, "");
}

/** Base URL du backend Next (Railway) — jamais localhost en prod grâce au défaut. */
export function getApiBaseUrl(): string {
  const fromExtra = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  const raw = fromExtra?.trim() || fromEnv?.trim() || MOBOKO_SITE_URL_PRODUCTION;
  return trimSlash(raw);
}

/** Origine du site web (callbacks OAuth mobile = schéma moboko://, ce champ sert aux redirections Supabase côté API). */
export function getSiteUrl(): string {
  const fromExtra = Constants.expoConfig?.extra?.siteUrl as string | undefined;
  const fromEnv = process.env.EXPO_PUBLIC_SITE_URL;
  const raw = fromExtra?.trim() || fromEnv?.trim() || MOBOKO_SITE_URL_PRODUCTION;
  return trimSlash(raw);
}
