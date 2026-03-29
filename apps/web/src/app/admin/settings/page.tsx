import { HeroBrandingCard } from "@/components/admin/HeroBrandingCard";
import { PublicSettingsForm } from "@/components/admin/PublicSettingsForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  ALL_PUBLIC_APP_SETTING_KEYS,
  PUBLIC_APP_SETTING_KEYS,
  parseAppSettingScalar,
  type JsonScalar,
} from "@moboko/shared";

export default async function AdminSettingsPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/auth");

  const { data: rows } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ALL_PUBLIC_APP_SETTING_KEYS);

  const initial: Record<string, JsonScalar> = {};
  for (const k of ALL_PUBLIC_APP_SETTING_KEYS) {
    initial[k] = null;
  }
  for (const row of rows ?? []) {
    initial[row.key] = parseAppSettingScalar(row.value);
  }

  const heroRaw = initial[PUBLIC_APP_SETTING_KEYS.homeHeroImageUrl];
  const heroUrl = typeof heroRaw === "string" ? heroRaw : null;

  return (
    <div className="space-y-12">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Configuration
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
          Paramètres publics
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          Contenu affiché sur l’accueil et options du chat (sans clé OpenAI).
        </p>
      </div>

      <HeroBrandingCard currentPublicUrl={heroUrl} />

      <PublicSettingsForm initial={initial} />
    </div>
  );
}
