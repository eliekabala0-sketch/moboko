import type { SupabaseClient } from "@supabase/supabase-js";
import { currentMonthKey } from "@/lib/billing/monthly-period";
import { getActiveSubscriptionAccess } from "@/lib/billing/subscriptions";

export async function ensureMonthlySubscriptionCredits(
  admin: SupabaseClient,
  userId: string,
  monthlyCredits: number,
): Promise<{ granted: boolean; credits: number }> {
  const credits = Math.max(0, Math.floor(monthlyCredits));
  if (credits <= 0) return { granted: false, credits: 0 };

  const sub = await getActiveSubscriptionAccess(admin, userId);
  if (!sub.active) return { granted: false, credits: 0 };

  const monthKey = currentMonthKey();
  const { data: grant, error: grantErr } = await admin
    .from("subscription_credit_grants")
    .insert({
      user_id: userId,
      subscription_id: sub.subscriptionId,
      month_key: monthKey,
      credits,
    })
    .select("id")
    .maybeSingle();

  if (grantErr || !grant?.id) return { granted: false, credits: 0 };

  const { data: profile } = await admin
    .from("profiles")
    .select("credit_balance")
    .eq("id", userId)
    .single();
  const balance = typeof profile?.credit_balance === "number" ? profile.credit_balance : 0;
  const next = balance + credits;

  await admin.from("profiles").update({ credit_balance: next }).eq("id", userId);
  await admin.from("credit_logs").insert({
    user_id: userId,
    delta: credits,
    balance_after: next,
    reason: "subscription_monthly_ai_credits",
    ref_type: "subscription",
    ref_id: sub.subscriptionId,
  });

  return { granted: true, credits };
}
