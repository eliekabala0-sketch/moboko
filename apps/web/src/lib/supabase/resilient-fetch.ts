import { Agent } from "undici";

const supabaseHttpAgent = new Agent({
  connectTimeout: 45_000,
  headersTimeout: 110_000,
  bodyTimeout: 110_000,
});

/**
 * Fetch pour Supabase : timeouts HTTP/connexion plus tolérants qu’avec le fetch par défaut (undici ~10s en connexion).
 */
export function supabaseResilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, {
    ...init,
    dispatcher: supabaseHttpAgent,
  } as RequestInit & { dispatcher: typeof supabaseHttpAgent });
}
