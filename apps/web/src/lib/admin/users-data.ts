import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/admin/require-admin";

export type AdminUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  credit_balance: number;
  is_premium: boolean;
  is_free_access: boolean;
};

export async function fetchUsersForAdmin(): Promise<AdminUserRow[]> {
  await requireAdmin();
  const svc = createSupabaseServiceClient();
  if (!svc) {
    throw new Error("Client service Supabase indisponible (SUPABASE_SERVICE_ROLE_KEY).");
  }

  const { data: list, error: listErr } = await svc.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listErr) {
    throw new Error(listErr.message);
  }

  const users = list?.users ?? [];
  if (users.length === 0) return [];

  const ids = users.map((u) => u.id);
  const { data: profs, error: pErr } = await svc
    .from("profiles")
    .select("id, display_name, credit_balance, is_premium, is_free_access")
    .in("id", ids);

  if (pErr) {
    throw new Error(pErr.message);
  }

  const byId = new Map((profs ?? []).map((p) => [p.id as string, p]));

  return users.map((u) => {
    const p = byId.get(u.id);
    return {
      id: u.id,
      email: u.email ?? null,
      display_name: p?.display_name ?? null,
      credit_balance: typeof p?.credit_balance === "number" ? p.credit_balance : 0,
      is_premium: Boolean(p?.is_premium),
      is_free_access: Boolean(p?.is_free_access),
    };
  });
}
