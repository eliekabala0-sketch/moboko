import { MOBOKO_SITE_URL_PRODUCTION } from "@moboko/shared";

/**
 * Origine du site (https://… sans slash final) — callbacks OAuth / OTP e-mail.
 * Définir NEXT_PUBLIC_SITE_URL sur Railway ; repli = production Moboko.
 */
export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || MOBOKO_SITE_URL_PRODUCTION;
  return raw.replace(/\/$/, "");
}
