"use server";

import { requireAdmin } from "@/lib/admin/require-admin";
import { revalidatePath } from "next/cache";

function readId(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Element introuvable");
  return id;
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function adminName(formData: FormData, fallback: string | null) {
  if (formData.get("anonymous") === "on") return null;
  return text(formData, "name") || fallback || "Admin Moboko";
}

export async function createPrayerRequestAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const requestText = text(formData, "request_text");
  if (requestText.length < 3) throw new Error("Requete vide");
  const { error } = await supabase.from("prayer_requests").insert({
    user_id: null,
    name: adminName(formData, user.email ?? null),
    email: text(formData, "email") || null,
    request_text: requestText,
    status: formData.get("publish") === "on" ? "reviewed" : "pending",
    is_public: formData.get("is_public") === "on",
    created_by_admin: true,
    anonymous: formData.get("anonymous") === "on",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
  revalidatePath("/requests");
  revalidatePath("/posts");
}

export async function createTestimonyAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const title = text(formData, "title");
  const testimonyText = text(formData, "testimony_text");
  if (title.length < 2 || testimonyText.length < 3) throw new Error("Temoignage incomplet");
  const { error } = await supabase.from("testimonies").insert({
    user_id: null,
    name: adminName(formData, user.email ?? null),
    title,
    testimony_text: testimonyText,
    status: formData.get("publish") === "on" ? "published" : "pending",
    created_by_admin: true,
    anonymous: formData.get("anonymous") === "on",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
  revalidatePath("/testimonies");
  revalidatePath("/posts");
}

export async function reviewPrayerRequestAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const isPublic = formData.get("is_public") === "on";
  const { error } = await supabase
    .from("prayer_requests")
    .update({ status: "reviewed", is_public: isPublic })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
  revalidatePath("/requests");
}

export async function archivePrayerRequestAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const { error } = await supabase
    .from("prayer_requests")
    .update({ status: "archived", is_public: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
  revalidatePath("/requests");
}

export async function deletePrayerRequestAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const { error } = await supabase.from("prayer_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
  revalidatePath("/requests");
}

export async function publishTestimonyAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const { error } = await supabase.from("testimonies").update({ status: "published" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
  revalidatePath("/testimonies");
}

export async function archiveTestimonyAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const { error } = await supabase.from("testimonies").update({ status: "archived" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
  revalidatePath("/testimonies");
}

export async function deleteTestimonyAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const { error } = await supabase.from("testimonies").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
  revalidatePath("/testimonies");
}

export async function reviewSupportMessageAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const { error } = await supabase.from("support_messages").update({ status: "reviewed" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
}

export async function archiveSupportMessageAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const { error } = await supabase.from("support_messages").update({ status: "archived" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
}

export async function deleteSupportMessageAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = readId(formData);
  const { error } = await supabase.from("support_messages").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/engagement");
}
