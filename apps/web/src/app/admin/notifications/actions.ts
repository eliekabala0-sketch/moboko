"use server";

import { sendPushEvent } from "@/lib/notifications/push";
import { requireAdmin } from "@/lib/admin/require-admin";
import { revalidatePath } from "next/cache";

export async function resendNotificationAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const { data: event, error } = await supabase
    .from("notification_events")
    .select("kind, title, body, url, priority, post_id")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  await sendPushEvent(supabase, {
    kind: String(event.kind),
    title: String(event.title),
    body: String(event.body),
    url: String(event.url),
    priority: event.priority === "high" ? "high" : "normal",
    postId: event.post_id,
    createdBy: user.id,
  });
  revalidatePath("/admin/notifications");
}
