import { handleContinueScope } from "@/lib/chat/sermon-tools-handlers";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

export async function POST(request: Request) {
  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) {
    return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  }
  const admin = createSupabaseServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }
  const conversationId =
    isRecord(raw) && typeof raw.conversation_id === "string" ? raw.conversation_id.trim() : "";
  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id_requis" }, { status: 400 });
  }
  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .select("user_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr || !conv || conv.user_id !== user.id) {
    return NextResponse.json({ error: "conversation_inaccessible" }, { status: 403 });
  }
  const out = await handleContinueScope(admin, raw, {});
  return NextResponse.json(out);
}
