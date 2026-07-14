"use server";

import { normalizeAppearancePayload, type AppearancePayload } from "@/lib/appearance/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function adminClient() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Non authentifie");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifie");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") throw new Error("Acces reserve aux administrateurs");

  return { supabase, user };
}

function revalidateAppearance() {
  revalidatePath("/");
  revalidatePath("/download");
  revalidatePath("/admin/appearance");
  revalidatePath("/admin/settings");
}

export async function saveAppearanceDraftAction(payload: AppearancePayload) {
  const { supabase, user } = await adminClient();
  const clean = normalizeAppearancePayload(payload);

  const { data: existing } = await supabase
    .from("appearance_revisions")
    .select("id")
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    status: "draft",
    title: "Brouillon apparence",
    payload: clean as never,
    updated_by: user.id,
  };

  const { error } = existing?.id
    ? await supabase.from("appearance_revisions").update(row).eq("id", existing.id)
    : await supabase.from("appearance_revisions").insert({ ...row, created_by: user.id });
  if (error) throw new Error(error.message);
  revalidateAppearance();
}

export async function publishAppearanceAction(payload: AppearancePayload) {
  const { supabase, user } = await adminClient();
  const clean = normalizeAppearancePayload(payload);

  const { error: archiveErr } = await supabase
    .from("appearance_revisions")
    .update({ status: "archived", updated_by: user.id })
    .eq("status", "published");
  if (archiveErr) throw new Error(archiveErr.message);

  const { data: published, error: insertErr } = await supabase
    .from("appearance_revisions")
    .insert({
      status: "published",
      title: "Version publiee",
      payload: clean as never,
      created_by: user.id,
      updated_by: user.id,
      published_by: user.id,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertErr || !published) throw new Error(insertErr?.message ?? "Publication impossible");

  const { error: settingErr } = await supabase.from("app_settings").upsert(
    {
      key: "appearance_published_revision_id",
      value: published.id as never,
      updated_by: user.id,
    },
    { onConflict: "key" },
  );
  if (settingErr) throw new Error(settingErr.message);

  const { error: draftErr } = await supabase
    .from("appearance_revisions")
    .update({ status: "archived", updated_by: user.id })
    .eq("status", "draft");
  if (draftErr) throw new Error(draftErr.message);

  revalidateAppearance();
}

export async function restoreAppearanceRevisionAction(revisionId: string) {
  const { supabase, user } = await adminClient();
  const id = revisionId.trim();
  if (!id) throw new Error("Version introuvable");

  const { data: source, error: sourceErr } = await supabase
    .from("appearance_revisions")
    .select("id, payload")
    .eq("id", id)
    .maybeSingle();
  if (sourceErr || !source) throw new Error(sourceErr?.message ?? "Version introuvable");

  const { data: existing } = await supabase
    .from("appearance_revisions")
    .select("id")
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    status: "draft",
    title: "Brouillon restaure",
    payload: normalizeAppearancePayload(source.payload) as never,
    restored_from: source.id,
    updated_by: user.id,
  };
  const { error } = existing?.id
    ? await supabase.from("appearance_revisions").update(row).eq("id", existing.id)
    : await supabase.from("appearance_revisions").insert({ ...row, created_by: user.id });
  if (error) throw new Error(error.message);
  revalidateAppearance();
}

export async function uploadAppearanceAssetAction(formData: FormData) {
  const { supabase } = await adminClient();
  const file = formData.get("file") as File | null;
  const slot = String(formData.get("slot") ?? "asset").replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "asset";
  if (!file || file.size === 0) throw new Error("Aucun fichier");
  if (!file.type.startsWith("image/")) throw new Error("Image requise");

  const ext = (file.name.includes(".") ? file.name.split(".").pop() : "png") || "png";
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const path = `appearance/${slot}-${Date.now()}.${safeExt}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from("branding").upload(path, buf, {
    contentType: file.type || "image/png",
    upsert: true,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("branding").getPublicUrl(path);
  return data.publicUrl;
}
