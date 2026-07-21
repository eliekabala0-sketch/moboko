import { sendPushEvent } from "@/lib/notifications/push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.MOBOKO_CRON_SECRET?.trim();
  if (secret && request.headers.get("x-moboko-cron-secret") !== secret) {
    return NextResponse.json({ error: "non_autorise" }, { status: 401 });
  }
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const { data: posts, error } = await admin
    .from("posts")
    .select("id, title, body, post_type, priority, notify_on_publish, notification_title, notification_body")
    .eq("status", "draft")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", new Date().toISOString())
    .limit(20);
  if (error) return NextResponse.json({ error: "publication_programmee_indisponible" }, { status: 500 });
  let published = 0;
  for (const post of posts ?? []) {
    const { error: updateError } = await admin
      .from("posts")
      .update({ status: "published", published_at: new Date().toISOString(), scheduled_at: null })
      .eq("id", post.id);
    if (updateError) continue;
    published += 1;
    if (post.notify_on_publish) {
      await sendPushEvent(admin, {
        kind: String(post.post_type ?? "publication"),
        title: String(post.notification_title || post.title),
        body: String(post.notification_body || post.body || "").slice(0, 180),
        url: `/posts#publication-${post.id}`,
        priority: post.priority === "high" ? "high" : "normal",
        postId: String(post.id),
      });
      await admin.from("posts").update({ notification_sent_at: new Date().toISOString() }).eq("id", post.id);
    }
  }
  return NextResponse.json({ ok: true, published });
}
