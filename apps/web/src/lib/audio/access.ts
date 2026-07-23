import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AudioRight = "audio_streaming" | "audio_offline_in_app" | "audio_full_download" | "audio_search";

export type AudioAccess = Record<AudioRight, boolean> & {
  subscriptionActive: boolean;
  planKey: string | null;
  overrideApplied: boolean;
  freeApplied: boolean;
  freeExcerptSeconds: number | null;
  accessSource: "none" | "subscription" | "admin" | "override" | "free";
  admin: boolean;
};

export type AudioAccessItem = {
  id?: string | null;
  access_policy?: string | null;
  free_excerpt_seconds?: number | null;
  free_monthly_play_limit?: number | null;
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
    freeApplied: false,
    freeExcerptSeconds: null,
    accessSource: "none",
    admin: false,
  };
}

async function getFreeAudioSettings(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("audio_access_settings")
    .select("free_streaming_enabled, free_streaming_monthly_limit, free_offline_in_app, free_full_download, free_audio_search, free_excerpt_seconds")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) {
    return {
      free_streaming_enabled: false,
      free_streaming_monthly_limit: null as number | null,
      free_offline_in_app: false,
      free_full_download: false,
      free_audio_search: false,
      free_excerpt_seconds: 0,
    };
  }
  return data;
}

async function applyFreeAudioAccess(admin: SupabaseClient, access: AudioAccess, audio?: AudioAccessItem | null) {
  if (!audio) return access;
  const policy = audio.access_policy ?? "subscription";
  if (policy === "subscription" || policy === "unavailable") return access;
  const settings = await getFreeAudioSettings(admin);
  const excerptSeconds = Number(audio.free_excerpt_seconds || settings.free_excerpt_seconds || 0);
  const fullFree = policy === "free";
  const excerptFree = policy === "excerpt" && excerptSeconds > 0;
  if (!fullFree && !excerptFree) return access;
  access.freeApplied = true;
  access.accessSource = "free";
  access.planKey = fullFree ? "free_audio" : "free_excerpt";
  access.freeExcerptSeconds = excerptFree ? excerptSeconds : null;
  access.audio_streaming = Boolean(settings.free_streaming_enabled);
  access.audio_offline_in_app = fullFree && Boolean(settings.free_offline_in_app);
  access.audio_full_download = fullFree && Boolean(settings.free_full_download);
  access.audio_search = fullFree && Boolean(settings.free_audio_search);
  return access;
}

export async function getAudioAccess(admin: SupabaseClient, user: User | null, audio?: AudioAccessItem | null): Promise<AudioAccess> {
  if (!user) return applyFreeAudioAccess(admin, emptyAccess(), audio);

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
      freeApplied: false,
      freeExcerptSeconds: null,
      accessSource: isAdmin ? "admin" : "subscription",
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
    access.accessSource = "subscription";
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
        access.accessSource = "override";
      }
    }
  }

  if (!access.subscriptionActive && !access.overrideApplied) {
    return applyFreeAudioAccess(admin, access, audio);
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
    "title_original",
    "sermon_code",
    "search_aliases",
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
    "access_policy",
    "free_excerpt_seconds",
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
