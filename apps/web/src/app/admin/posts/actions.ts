"use server";

import { sendPushEvent } from "@/lib/notifications/push";
import { requireAdmin } from "@/lib/admin/require-admin";
import { revalidatePath } from "next/cache";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || `publication-${Date.now()}`
  );
}

export async function createPostAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const title = text(formData, "title");
  const body = text(formData, "body");
  if (title.length < 2 || body.length < 3) throw new Error("Titre ou contenu manquant");
  const postType = text(formData, "post_type") || "publication";
  const priority = text(formData, "priority") === "high" ? "high" : "normal";
  const status = text(formData, "status") === "published" ? "published" : "draft";
  const scheduledRaw = text(formData, "scheduled_at");
  const scheduledAt = scheduledRaw ? new Date(scheduledRaw).toISOString() : null;
  const importantPost = postType === "announcement" || postType === "mass_message";
  const notify = formData.get("notify_on_publish") === "on" || importantPost;
  const effectivePriority = importantPost ? "high" : priority;
  const slug = `${slugify(title)}-${Date.now().toString(36)}`;
  const publishedAt = status === "published" && !scheduledAt ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("posts")
    .insert({
      author_id: user.id,
      title,
      slug,
      excerpt: text(formData, "excerpt") || body.slice(0, 220),
      body,
      status: scheduledAt ? "draft" : status,
      published_at: publishedAt,
      post_type: postType,
      priority: effectivePriority,
      scheduled_at: scheduledAt,
      notify_on_publish: notify,
      notification_title: text(formData, "notification_title") || title,
      notification_body: text(formData, "notification_body") || body.slice(0, 160),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (notify && publishedAt && data?.id) {
    await sendPushEvent(supabase, {
      kind: postType,
      title: text(formData, "notification_title") || title,
      body: text(formData, "notification_body") || body.slice(0, 160),
      url: `/posts#publication-${data.id}`,
      priority: effectivePriority,
      postId: data.id,
      createdBy: user.id,
    });
    await supabase.from("posts").update({ notification_sent_at: new Date().toISOString() }).eq("id", data.id);
  }

  revalidatePath("/admin/posts");
  revalidatePath("/posts");
}

export async function publishPostAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const id = text(formData, "id");
  const notify = formData.get("notify") === "on";
  const { data: post, error: readError } = await supabase
    .from("posts")
    .select("id, title, body, post_type, priority, notification_title, notification_body")
    .eq("id", id)
    .single();
  if (readError) throw new Error(readError.message);
  const { error } = await supabase
    .from("posts")
    .update({ status: "published", published_at: new Date().toISOString(), scheduled_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  const importantPost = post.post_type === "announcement" || post.post_type === "mass_message";
  if (notify || importantPost) {
    await sendPushEvent(supabase, {
      kind: String(post.post_type ?? "publication"),
      title: String(post.notification_title || post.title),
      body: String(post.notification_body || post.body || "").slice(0, 180),
      url: `/posts#publication-${id}`,
      priority: importantPost || post.priority === "high" ? "high" : "normal",
      postId: id,
      createdBy: user.id,
    });
    await supabase.from("posts").update({ notification_sent_at: new Date().toISOString() }).eq("id", id);
  }
  revalidatePath("/admin/posts");
  revalidatePath("/posts");
}
