import type { SupabaseClient } from "@supabase/supabase-js";
import { currentMonthKey } from "@/lib/billing/monthly-period";
import { getActiveSubscriptionAccess } from "@/lib/billing/subscriptions";

export type NormalSearchQuotaResult =
  | { ok: true; subscriptionActive: boolean; used: number; limit: number; remaining: number | null }
  | { ok: false; error: "auth_required" | "quota_exceeded"; used: number; limit: number; remaining: 0 };

export async function consumeNormalSearchQuota(
  admin: SupabaseClient,
  userId: string | null,
  monthlyLimit: number,
): Promise<NormalSearchQuotaResult> {
  const limit = Math.max(0, Math.floor(monthlyLimit));
  if (!userId) {
    return { ok: false, error: "auth_required", used: 0, limit, remaining: 0 };
  }

  const sub = await getActiveSubscriptionAccess(admin, userId);
  if (sub.active) {
    return { ok: true, subscriptionActive: true, used: 0, limit, remaining: null };
  }

  const monthKey = currentMonthKey();
  const { data: existing } = await admin
    .from("normal_search_usage")
    .select("search_count")
    .eq("user_id", userId)
    .eq("month_key", monthKey)
    .maybeSingle();

  const used = typeof existing?.search_count === "number" ? existing.search_count : 0;
  if (limit <= 0 || used >= limit) {
    return { ok: false, error: "quota_exceeded", used, limit, remaining: 0 };
  }

  const next = used + 1;
  await admin.from("normal_search_usage").upsert(
    {
      user_id: userId,
      month_key: monthKey,
      search_count: next,
    },
    { onConflict: "user_id,month_key" },
  );

  return {
    ok: true,
    subscriptionActive: false,
    used: next,
    limit,
    remaining: Math.max(0, limit - next),
  };
}
