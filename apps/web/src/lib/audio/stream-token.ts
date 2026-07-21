import { createHmac, timingSafeEqual } from "node:crypto";

type TokenPayload = {
  audioId: string;
  action: "stream" | "offline" | "download";
  exp: number;
};

function secret() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXTAUTH_SECRET ?? "";
  if (!value) throw new Error("audio_token_secret_missing");
  return value;
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

export function createAudioToken(payload: TokenPayload) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAudioToken(token: string | null, audioId: string, action: TokenPayload["action"]) {
  if (!token || !token.includes(".")) return false;
  const [body, sig] = token.split(".", 2);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const got = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return false;
  }
  return payload.audioId === audioId && payload.action === action && payload.exp >= Math.floor(Date.now() / 1000);
}
