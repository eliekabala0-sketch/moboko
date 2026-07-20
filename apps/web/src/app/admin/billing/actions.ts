"use server";

import { requireAdmin } from "@/lib/admin/require-admin";
import { revalidatePath } from "next/cache";

function text(formData: FormData, key: string, fallback = "") {
  return String(formData.get(key) ?? fallback).trim();
}

function intValue(formData: FormData, key: string, fallback = 0) {
  const n = Number(formData.get(key) ?? fallback);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function boolValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function keyFromName(name: string, fallback: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || fallback
  );
}

export async function saveSubscriptionPlanAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const id = text(formData, "id");
  const name = text(formData, "name");
  if (!name) throw new Error("Nom requis");
  const price = intValue(formData, "price");
  if (price <= 0) throw new Error("Prix invalide");
  const payload = {
    plan_key: text(formData, "plan_key") || keyFromName(name, `plan_${Date.now()}`),
    name,
    description: text(formData, "description"),
    user_visible_text: text(formData, "user_visible_text"),
    price,
    currency: text(formData, "currency", "USD").toUpperCase() || "USD",
    duration_days: Math.max(1, intValue(formData, "duration_days", 30)),
    benefits: text(formData, "benefits")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean) as never,
    normal_search_unlimited: boolValue(formData, "normal_search_unlimited"),
    pdf_allowed: boolValue(formData, "pdf_allowed"),
    audio_streaming: boolValue(formData, "audio_streaming"),
    audio_offline_in_app: boolValue(formData, "audio_offline_in_app"),
    audio_full_download: boolValue(formData, "audio_full_download"),
    audio_search: boolValue(formData, "audio_search"),
    monthly_ai_credits: intValue(formData, "monthly_ai_credits"),
    export_limit: text(formData, "export_limit") ? intValue(formData, "export_limit") : null,
    is_active: boolValue(formData, "is_active"),
    is_featured: boolValue(formData, "is_featured"),
    display_order: intValue(formData, "display_order", 100),
    updated_by: user.id,
  };
  const query = id
    ? supabase.from("billing_subscription_plans").update(payload).eq("id", id)
    : supabase.from("billing_subscription_plans").insert({ ...payload, created_by: user.id });
  const { error } = await query;
  if (error) throw new Error(error.message);
  revalidatePath("/billing");
  revalidatePath("/admin/billing");
}

export async function saveCreditPackAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const id = text(formData, "id");
  const name = text(formData, "name");
  if (!name) throw new Error("Nom requis");
  const price = intValue(formData, "price");
  const credits = intValue(formData, "credits");
  if (price <= 0 || credits <= 0) throw new Error("Pack invalide");
  const payload = {
    pack_key: text(formData, "pack_key") || keyFromName(name, `pack_${Date.now()}`),
    name,
    description: text(formData, "description"),
    credits,
    bonus_credits: intValue(formData, "bonus_credits"),
    price,
    currency: text(formData, "currency", "USD").toUpperCase() || "USD",
    is_active: boolValue(formData, "is_active"),
    is_featured: boolValue(formData, "is_featured"),
    display_order: intValue(formData, "display_order", 100),
    updated_by: user.id,
  };
  const query = id
    ? supabase.from("billing_credit_packs").update(payload).eq("id", id)
    : supabase.from("billing_credit_packs").insert({ ...payload, created_by: user.id });
  const { error } = await query;
  if (error) throw new Error(error.message);
  revalidatePath("/billing");
  revalidatePath("/admin/billing");
}
