"use server";

import { requireAdmin } from "@/lib/admin/require-admin";
import { revalidatePath } from "next/cache";

function readId(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Element introuvable");
  return id;
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
