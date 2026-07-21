import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

type PushRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type EventInput = {
  kind: string;
  title: string;
  body: string;
  url: string;
  priority: "normal" | "high";
  postId?: string | null;
  createdBy?: string | null;
};

export function pushConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() &&
      process.env.VAPID_PRIVATE_KEY?.trim() &&
      process.env.VAPID_SUBJECT?.trim(),
  );
}

export function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function preferenceColumn(kind: string) {
  if (kind === "announcement" || kind === "mass_message") return "important_announcements";
  if (kind === "publication") return "publications";
  if (kind === "prayer_request") return "prayer_requests";
  if (kind === "testimony") return "testimonies";
  if (kind === "prayer_reply") return "prayer_replies";
  if (kind === "testimony_reply") return "testimony_replies";
  return "all_notifications";
}

export async function sendPushEvent(admin: SupabaseClient, input: EventInput) {
  const { data: event, error: eventError } = await admin
    .from("notification_events")
    .insert({
      kind: input.kind,
      title: input.title,
      body: input.body,
      url: input.url,
      priority: input.priority,
      status: "sending",
      post_id: input.postId ?? null,
      created_by: input.createdBy ?? null,
      payload: { source: "admin" },
    })
    .select("id")
    .single();
  if (eventError) throw eventError;

  const { data: subscriptions, error: subError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("is_active", true);
  if (subError) throw subError;

  const prefCol = preferenceColumn(input.kind);
  const users = [...new Set((subscriptions ?? []).map((row: PushRow) => row.user_id))];
  const { data: prefs } = users.length
    ? await admin
        .from("notification_preferences")
        .select("user_id, all_notifications, important_announcements, publications, prayer_requests, testimonies, prayer_replies, testimony_replies")
        .in("user_id", users)
    : { data: [] };
  const prefByUser = new Map((prefs ?? []).map((pref) => [pref.user_id, pref]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const configured = configureWebPush();

  for (const row of (subscriptions ?? []) as PushRow[]) {
    const pref = prefByUser.get(row.user_id) as Record<string, boolean> | undefined;
    const allowed = pref ? Boolean(pref.all_notifications && pref[prefCol] !== false) : true;
    if (!allowed || !configured) {
      skipped += 1;
      await admin.from("notification_deliveries").insert({
        event_id: event.id,
        user_id: row.user_id,
        subscription_id: row.id,
        status: configured ? "skipped" : "failed",
        error: configured ? "preference_disabled" : "vapid_not_configured",
      });
      continue;
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        JSON.stringify({
          title: input.title,
          body: input.body,
          url: input.url,
          priority: input.priority,
          eventId: event.id,
        }),
        { urgency: input.priority === "high" ? "high" : "normal" },
      );
      sent += 1;
      await admin.from("notification_deliveries").insert({
        event_id: event.id,
        user_id: row.user_id,
        subscription_id: row.id,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await admin.from("notification_deliveries").insert({
        event_id: event.id,
        user_id: row.user_id,
        subscription_id: row.id,
        status: "failed",
        error: message.slice(0, 500),
      });
    }
  }

  await admin
    .from("notification_events")
    .update({
      status: failed > 0 && sent === 0 ? "failed" : "sent",
      sent_at: new Date().toISOString(),
      payload: { sent, failed, skipped },
    })
    .eq("id", event.id);

  return { eventId: event.id as string, sent, failed, skipped };
}
