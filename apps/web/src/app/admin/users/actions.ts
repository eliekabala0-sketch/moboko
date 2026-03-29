"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function adminSession() {
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

export async function updateUserBillingAction(input: {
  userId: string;
  credit_balance: number;
  is_premium: boolean;
  is_free_access: boolean;
}) {
  const { supabase } = await adminSession();
  const credits = Math.max(0, Math.floor(Number(input.credit_balance)));
  const { error } = await supabase
    .from("profiles")
    .update({
      credit_balance: credits,
      is_premium: input.is_premium,
      is_free_access: input.is_free_access,
    })
    .eq("id", input.userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
  revalidatePath("/chat");
}
