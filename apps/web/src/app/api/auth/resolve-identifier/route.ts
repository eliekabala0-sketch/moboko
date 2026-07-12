import { internalEmailForPhone, isEmailIdentifier, normalizePhoneIdentifier } from "@/lib/auth/phone-identifier";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let raw = "";
  try {
    const body = (await request.json()) as { identifier?: unknown };
    raw = typeof body.identifier === "string" ? body.identifier.trim() : "";
  } catch {
    return NextResponse.json({ error: "identifiant_invalide" }, { status: 400 });
  }
  if (!raw) return NextResponse.json({ error: "identifiant_invalide" }, { status: 400 });
  if (isEmailIdentifier(raw)) return NextResponse.json({ ok: true, authEmail: raw.toLowerCase(), type: "email" });

  const phone = normalizePhoneIdentifier(raw);
  if (!phone) return NextResponse.json({ error: "numero_invalide" }, { status: 400 });
  return NextResponse.json({ ok: true, authEmail: internalEmailForPhone(phone), type: "phone" });
}
