import {
  ALL_PUBLIC_APP_SETTING_KEYS,
  PUBLIC_APP_SETTING_KEYS,
  defaultPublicHomePageSettings,
  parseAppSettingScalar,
  type PublicHomePageSettings,
} from "@moboko/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function rowToPartial(
  key: string,
  raw: unknown,
): Partial<PublicHomePageSettings> {
  const v = parseAppSettingScalar(raw);
  switch (key) {
    case PUBLIC_APP_SETTING_KEYS.homeHeroImageUrl:
      return {
        homeHeroImageUrl: v === null || v === "" ? null : String(v),
      };
    case PUBLIC_APP_SETTING_KEYS.homeHeroTitle:
      return { homeHeroTitle: v == null ? "" : String(v) };
    case PUBLIC_APP_SETTING_KEYS.homeHeroSubtitle:
      return { homeHeroSubtitle: v == null ? "" : String(v) };
    case PUBLIC_APP_SETTING_KEYS.chatTextEnabled:
      return { chatTextEnabled: Boolean(v) };
    case PUBLIC_APP_SETTING_KEYS.chatVoiceEnabled:
      return { chatVoiceEnabled: Boolean(v) };
    case PUBLIC_APP_SETTING_KEYS.chatImageEnabled:
      return { chatImageEnabled: Boolean(v) };
    case PUBLIC_APP_SETTING_KEYS.textCreditCost:
      return {
        textCreditCost: typeof v === "number" && Number.isFinite(v) ? v : 1,
      };
    case PUBLIC_APP_SETTING_KEYS.voiceCreditCost:
      return {
        voiceCreditCost: typeof v === "number" && Number.isFinite(v) ? v : 2,
      };
    case PUBLIC_APP_SETTING_KEYS.imageCreditCost:
      return {
        imageCreditCost: typeof v === "number" && Number.isFinite(v) ? v : 3,
      };
    case PUBLIC_APP_SETTING_KEYS.initialFreeCredits:
      return {
        initialFreeCredits: typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 5,
      };
    case PUBLIC_APP_SETTING_KEYS.sermonAiSearchEnabled:
      return { sermonAiSearchEnabled: Boolean(v) };
    case PUBLIC_APP_SETTING_KEYS.sermonAiSearchCreditCost:
      return {
        sermonAiSearchCreditCost:
          typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 2,
      };
    default:
      return {};
  }
}

export async function fetchPublicAppSettings(): Promise<PublicHomePageSettings> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ...defaultPublicHomePageSettings };
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ALL_PUBLIC_APP_SETTING_KEYS);

  if (error || !data?.length) {
    return { ...defaultPublicHomePageSettings };
  }

  const merged: PublicHomePageSettings = { ...defaultPublicHomePageSettings };
  for (const row of data) {
    Object.assign(merged, rowToPartial(row.key, row.value));
  }
  return merged;
}
