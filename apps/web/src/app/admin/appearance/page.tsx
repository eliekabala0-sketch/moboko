import { AppearanceStudio } from "@/components/admin/AppearanceStudio";
import { fetchAdminAppearanceState } from "@/lib/appearance/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AdminAppearancePage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/auth");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/");

  const state = await fetchAdminAppearanceState();
  return <AppearanceStudio draft={state.draft} published={state.published} history={state.history} />;
}
