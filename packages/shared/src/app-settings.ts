/**
 * Clés `app_settings` lisibles publiquement (anon + authentifié).
 * Valeurs stockées en JSON scalaire (string, number, boolean, null).
 */
export const PUBLIC_APP_SETTING_KEYS = {
  homeHeroImageUrl: "home_hero_image_url",
  homeHeroTitle: "home_hero_title",
  homeHeroSubtitle: "home_hero_subtitle",
  chatTextEnabled: "chat_text_enabled",
  chatVoiceEnabled: "chat_voice_enabled",
  chatImageEnabled: "chat_image_enabled",
  textCreditCost: "text_credit_cost",
  voiceCreditCost: "voice_credit_cost",
  imageCreditCost: "image_credit_cost",
  /** Crédits attribués à chaque nouveau compte (trigger profil). */
  initialFreeCredits: "initial_free_credits",
} as const;

/** Liste alignée sur `app_setting_is_public_readable` côté SQL. */
export const ALL_PUBLIC_APP_SETTING_KEYS: PublicAppSettingKey[] = Object.values(
  PUBLIC_APP_SETTING_KEYS,
) as PublicAppSettingKey[];

export type PublicAppSettingKey =
  (typeof PUBLIC_APP_SETTING_KEYS)[keyof typeof PUBLIC_APP_SETTING_KEYS];

export type JsonScalar = string | number | boolean | null;

export function parseAppSettingScalar(value: unknown): JsonScalar {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

export type PublicHomePageSettings = {
  homeHeroImageUrl: string | null;
  homeHeroTitle: string;
  homeHeroSubtitle: string;
  chatTextEnabled: boolean;
  chatVoiceEnabled: boolean;
  chatImageEnabled: boolean;
  textCreditCost: number;
  voiceCreditCost: number;
  imageCreditCost: number;
  initialFreeCredits: number;
};

export const defaultPublicHomePageSettings: PublicHomePageSettings = {
  homeHeroImageUrl: null,
  homeHeroTitle: "",
  homeHeroSubtitle: "",
  chatTextEnabled: true,
  chatVoiceEnabled: true,
  chatImageEnabled: true,
  textCreditCost: 1,
  voiceCreditCost: 2,
  imageCreditCost: 3,
  initialFreeCredits: 5,
};
