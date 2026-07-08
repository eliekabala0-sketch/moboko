"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function adminSession() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Non authentifie");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifie");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") throw new Error("Acces reserve aux administrateurs");
  return { supabase };
}

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const number = String(formData.get("number") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim() || null;
  const lyrics = String(formData.get("lyrics") ?? "").trim();
  const isPublished = formData.get("is_published") === "on";
  if (!title) throw new Error("Titre requis");
  if (!lyrics) throw new Error("Texte requis");
  const slugBase = number ? `${number}-${title}` : title;
  return { title, number, category, lyrics, is_published: isPublished, slug: slugify(slugBase) || slugify(title) };
}

export async function createHymnAction(formData: FormData) {
  const { supabase } = await adminSession();
  const hymn = readForm(formData);
  const { error } = await supabase.from("hymns").insert(hymn);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/projection");
}

export async function updateHymnAction(formData: FormData) {
  const { supabase } = await adminSession();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Cantique introuvable");
  const hymn = readForm(formData);
  const { error } = await supabase.from("hymns").update(hymn).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/projection");
}

export async function deleteHymnAction(formData: FormData) {
  const { supabase } = await adminSession();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Cantique introuvable");
  const { error } = await supabase.from("hymns").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/projection");
}
