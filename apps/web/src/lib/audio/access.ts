import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AudioRight = "audio_streaming" | "audio_offline_in_app" | "audio_full_download" | "audio_search";

export type AudioAccess = Record<AudioRight, boolean> & {
  subscriptionActive: boolean;
  planKey: string | null;
  overrideApplied: boolean;
  admin: boolean;
};

const RIGHTS: AudioRight[] = [
  "audio_streaming",
  "audio_offline_in_app",
  "audio_full_download",
  "audio_search",
];

function periodIsCurrent(value: unknown, now = Date.now()) {
  if (value == null) return true;
  if (typeof value !== "string" || !value.trim()) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && t >= now;
}

function emptyAccess(): AudioAccess {
  return {
    audio_streaming: false,
    audio_offline_in_app: false,
    audio_full_download: false,
    audio_search: false,
    subscriptionActive: false,
    planKey: null,
    overrideApplied: false,
    admin: false,
  };
}

export async function getAudioAccess(admin: SupabaseClient, user: User | null): Promise<AudioAccess> {
  if (!user) return emptyAccess();

  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_premium, is_free_access")
    .eq("id", user.id)
    .maybeSingle();

  const isAdmin = profile?.role === "admin";
  if (isAdmin || profile?.is_premium || profile?.is_free_access) {
    return {
      audio_streaming: true,
      audio_offline_in_app: true,
      audio_full_download: true,
      audio_search: true,
      subscriptionActive: true,
      planKey: isAdmin ? "admin" : "free_access",
      overrideApplied: false,
      admin: isAdmin,
    };
  }

  const access = emptyAccess();
  const { data: subs } = await admin
    .from("subscriptions")
    .select("plan_key, status, current_period_end")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  for (const sub of subs ?? []) {
    if (sub.status !== "active") continue;
    if (!periodIsCurrent(sub.current_period_end)) continue;
    const planKey = typeof sub.plan_key === "string" ? sub.plan_key : "";
    if (!planKey) continue;
    const { data: plan } = await admin
      .from("billing_subscription_plans")
      .select("plan_key, audio_streaming, audio_offline_in_app, audio_full_download, audio_search")
      .eq("plan_key", planKey)
      .maybeSingle();
    if (!plan) continue;
    access.subscriptionActive = true;
    access.planKey = planKey;
    for (const right of RIGHTS) {
      access[right] = Boolean(plan[right]);
    }
    break;
  }

  const { data: override } = await admin
    .from("user_audio_access_overrides")
    .select("audio_streaming, audio_offline_in_app, audio_full_download, audio_search, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (override && periodIsCurrent(override.expires_at)) {
    for (const right of RIGHTS) {
      if (override[right] !== null && override[right] !== undefined) {
        access[right] = Boolean(override[right]);
        access.overrideApplied = true;
      }
    }
  }

  return access;
}

export function canUseAudioRight(access: AudioAccess, right: AudioRight) {
  return Boolean(access.admin || access[right]);
}

export function audioPublicSelect() {
  return [
    "id",
    "category",
    "title",
    "original_filename",
    "mime_type",
    "file_size",
    "duration_seconds",
    "sermon_id",
    "sermon_match_status",
    "sermon_date",
    "sermon_year",
    "location",
    "language",
    "streaming_enabled",
    "offline_enabled",
    "full_download_enabled",
    "sermons(id, slug, title, preached_on, year, location)",
  ].join(", ");
}

export function safeAudioFilename(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 140) || "moboko-audio"
  );
}
