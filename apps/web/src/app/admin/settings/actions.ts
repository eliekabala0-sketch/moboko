"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ALL_PUBLIC_APP_SETTING_KEYS,
  type JsonScalar,
  type PublicAppSettingKey,
} from "@moboko/shared";
import { revalidatePath } from "next/cache";

async function adminClient() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Non authentifié");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") throw new Error("Accès réservé aux administrateurs");

  return { supabase, user };
}

const allowedKeys = new Set<string>(ALL_PUBLIC_APP_SETTING_KEYS);

export async function savePublicAppSettingsAction(
  payload: Record<string, JsonScalar>,
) {
  const { supabase, user } = await adminClient();

  for (const [key, value] of Object.entries(payload)) {
    if (!allowedKeys.has(key)) continue;
    const { error } = await supabase.from("app_settings").upsert(
      {
        key: key as PublicAppSettingKey,
        value: value as never,
        updated_by: user.id,
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
  }

  revalidatePath("/");
  revalidatePath("/admin/settings");
}

export async function uploadBrandingHeroAction(formData: FormData) {
  const { supabase, user } = await adminClient();

  const file = formData.get("hero") as File | null;
  if (!file || file.size === 0) throw new Error("Aucun fichier");

  const ext =
    (file.name.includes(".") ? file.name.split(".").pop() : "jpg") || "jpg";
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  const path = `home-hero/main.${safeExt}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from("branding")
    .upload(path, buf, {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });

  if (upErr) throw new Error(upErr.message);

  const { data: pub } = supabase.storage.from("branding").getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { error: dbErr } = await supabase.from("app_settings").upsert(
    {
      key: "home_hero_image_url",
      value: publicUrl as never,
      updated_by: user.id,
    },
    { onConflict: "key" },
  );

  if (dbErr) throw new Error(dbErr.message);

  revalidatePath("/");
  revalidatePath("/admin/settings");
}

export async function clearBrandingHeroAction() {
  const { supabase, user } = await adminClient();

  const { data: row } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "home_hero_image_url")
    .maybeSingle();

  const url = row?.value;
  if (typeof url === "string" && url.includes("/storage/v1/object/public/branding/")) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/object/public/branding/");
      const objectPath = parts[1];
      if (objectPath) {
        await supabase.storage.from("branding").remove([decodeURIComponent(objectPath)]);
      }
    } catch {
      /* ignore parse errors */
    }
  }

  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "home_hero_image_url",
      value: null as never,
      updated_by: user.id,
    },
    { onConflict: "key" },
  );

  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/admin/settings");
}
