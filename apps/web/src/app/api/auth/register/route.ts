import { internalEmailForPhone, isEmailIdentifier, normalizePhoneIdentifier } from "@/lib/auth/phone-identifier";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function clean(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseAge(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const age = Math.floor(n);
  return age >= 10 && age <= 120 ? age : null;
}

function friendlyCreateError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("already") || lower.includes("registered") || lower.includes("duplicate")) {
    return "Ce compte existe deja. Connectez-vous avec votre identifiant.";
  }
  return "Le compte n'a pas pu etre cree. Verifiez les informations et reessayez.";
}

export async function POST(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) return NextResponse.json({ error: "service_indisponible" }, { status: 500 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }

  const fullName = clean(body.fullName, 100);
  const sex = clean(body.sex, 30);
  const city = clean(body.city, 80);
  const age = parseAge(body.age);
  const identifier = clean(body.identifier, 160);
  const password = clean(body.password, 200);
  if (!fullName || !city || !sex || age == null || password.length < 6 || !identifier) {
    return NextResponse.json(
      { error: "formulaire_invalide", message: "Completez les informations demandees." },
      { status: 400 },
    );
  }

  const isEmail = isEmailIdentifier(identifier);
  const phone = isEmail ? null : normalizePhoneIdentifier(identifier);
  if (!isEmail && !phone) {
    return NextResponse.json({ error: "numero_invalide", message: "Le numero de telephone n'est pas valide." }, { status: 400 });
  }
  const authEmail = isEmail ? identifier.toLowerCase() : internalEmailForPhone(phone!);

  const { data, error } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      sex,
      city,
      age,
      phone,
      auth_identifier_type: isEmail ? "email" : "phone",
      internal_auth_email: isEmail ? null : authEmail,
    },
  });
  if (error || !data.user) {
    return NextResponse.json({ error: "creation_compte", message: friendlyCreateError(error?.message ?? "") }, { status: 400 });
  }

  await admin
    .from("profiles")
    .update({
      display_name: fullName,
      full_name: fullName,
      sex,
      city,
      age,
      phone,
      auth_identifier_type: isEmail ? "email" : "phone",
      internal_auth_email: isEmail ? null : authEmail,
    })
    .eq("id", data.user.id);

  return NextResponse.json({ ok: true, authEmail });
}
