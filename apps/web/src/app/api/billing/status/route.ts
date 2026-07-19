import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TxRow = {
  id: string;
  external_id: string | null;
  status: string | null;
  purpose: string | null;
  amount: number | null;
  currency: string | null;
  created_at: string | null;
  completed_at: string | null;
};

function providerStatusUrl(externalId: string) {
  const tpl = process.env.BADIBOSS_PAY_STATUS_URL?.trim() ?? "";
  return tpl ? tpl.replace("{transaction_id}", encodeURIComponent(externalId)) : "";
}

function providerHeaders() {
  const apiKey = process.env.BADIBOSS_PAY_API_KEY?.trim() ?? "";
  const apiSecret = process.env.BADIBOSS_PAY_API_SECRET?.trim() ?? "";
  const appId = process.env.BADIBOSS_PAY_APP_ID?.trim() ?? "";
  const appSlug = process.env.BADIBOSS_PAY_APP_SLUG?.trim() ?? "moboko";
  return {
    Authorization: apiKey ? `Bearer ${apiKey}` : "",
    "X-API-Key": apiKey,
    "X-API-Secret": apiSecret,
    "X-Badiboss-API-Key": apiKey,
    "X-Badiboss-API-Secret": apiSecret,
    "X-Badiboss-App-Id": appId,
    "X-Badiboss-App-Slug": appSlug,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function classify(status: string) {
  const s = status.toLowerCase();
  if (["paid", "success", "completed", "confirmed"].includes(s)) return "success";
  if (["cancelled", "canceled", "rejected", "declined", "refused"].includes(s)) return "refused";
  if (["expired", "timeout", "timed_out"].includes(s)) return "expired";
  if (["provider_unavailable", "failed", "error"].includes(s)) return "error";
  return "pending";
}

async function fetchProviderStatus(externalId: string) {
  const url = providerStatusUrl(externalId);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: providerHeaders(), cache: "no-store" });
    const json = await res.json().catch(() => null);
    const data = asRecord(json);
    if (!res.ok || !data) return { ok: false, http_status: res.status, raw: data };
    const nested = asRecord(data.payment) ?? asRecord(data.provider_response) ?? data;
    const status = asString(data.status) || asString(nested.status) || asString(data.payment_status) || asString(nested.payment_status);
    return { ok: true, status: status || null, raw: data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  const { user, error } = await getUserFromApiRequest(request);
  if (error || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });

  const url = new URL(request.url);
  const id = (url.searchParams.get("transactionId") ?? "").trim();
  const ref = (url.searchParams.get("idempotencyKey") ?? "").trim();
  let query = admin
    .from("payment_transactions")
    .select("id, external_id, status, purpose, amount, currency, created_at, completed_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (id) query = query.eq("id", id);
  else if (ref) query = query.eq("idempotency_key", ref);
  const { data, error: txErr } = await query.maybeSingle();
  if (txErr) return NextResponse.json({ error: "statut_paiement_indisponible" }, { status: 500 });
  const tx = data as TxRow | null;
  if (!tx) return NextResponse.json({ ok: true, status: "none", message: "Aucun paiement recent." });

  const provider = tx.external_id ? await fetchProviderStatus(tx.external_id) : null;
  const providerStatus = provider?.ok && provider.status ? provider.status : null;
  const rawStatus = providerStatus || tx.status || "pending";
  const state = classify(rawStatus);
  const message =
    state === "success"
      ? "Paiement confirme."
      : state === "refused"
        ? "Paiement refuse par l'operateur."
        : state === "expired"
          ? "Paiement expire."
          : state === "error"
            ? "Le fournisseur de paiement est indisponible."
            : "Veuillez valider la transaction sur votre telephone.";

  return NextResponse.json({
    ok: true,
    status: state,
    raw_status: rawStatus,
    transaction: tx,
    provider_checked: Boolean(provider),
    provider_ok: provider?.ok ?? null,
    message,
  });
}
