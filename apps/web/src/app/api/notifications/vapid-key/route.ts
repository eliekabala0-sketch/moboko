import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  return NextResponse.json({ ok: Boolean(key), publicKey: key ?? null });
}
