import type { SupabaseClient } from "@supabase/supabase-js";

export type SubscriptionAccess = {
  active: boolean;
  subscriptionId: string | null;
  planKey: string | null;
  currentPeriodEnd: string | null;
};

const PDF_PLAN_KEYS = new Set(["pdf_monthly", "monthly_pdf", "monthly", "premium_monthly"]);

function isActiveStatus(status: unknown): boolean {
  return status === "active";
}

function periodIsCurrent(value: unknown, now = Date.now()): boolean {
  if (value == null) return true;
  if (typeof value !== "string" || !value.trim()) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && t >= now;
}

export async function getPdfSubscriptionAccess(
  admin: SupabaseClient,
  userId: string,
): Promise<SubscriptionAccess> {
  const { data } = await admin
    .from("subscriptions")
    .select("id, plan_key, status, current_period_end")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  for (const row of data ?? []) {
    const planKey = typeof row.plan_key === "string" ? row.plan_key : "";
    if (!PDF_PLAN_KEYS.has(planKey)) continue;
    if (!isActiveStatus(row.status)) continue;
    if (!periodIsCurrent(row.current_period_end)) continue;
    return {
      active: true,
      subscriptionId: typeof row.id === "string" ? row.id : null,
      planKey,
      currentPeriodEnd: typeof row.current_period_end === "string" ? row.current_period_end : null,
    };
  }

  return { active: false, subscriptionId: null, planKey: null, currentPeriodEnd: null };
}

export async function getActiveSubscriptionAccess(
  admin: SupabaseClient,
  userId: string,
): Promise<SubscriptionAccess> {
  const { data } = await admin
    .from("subscriptions")
    .select("id, plan_key, status, current_period_end")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  for (const row of data ?? []) {
    if (!isActiveStatus(row.status)) continue;
    if (!periodIsCurrent(row.current_period_end)) continue;
    return {
      active: true,
      subscriptionId: typeof row.id === "string" ? row.id : null,
      planKey: typeof row.plan_key === "string" ? row.plan_key : null,
      currentPeriodEnd: typeof row.current_period_end === "string" ? row.current_period_end : null,
    };
  }

  return { active: false, subscriptionId: null, planKey: null, currentPeriodEnd: null };
}
