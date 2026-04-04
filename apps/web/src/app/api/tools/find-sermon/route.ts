import {
  handleFindSermon,
} from "@/lib/chat/sermon-tools-handlers";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
  const out = await handleFindSermon(admin, raw);
  return NextResponse.json(out);
}
