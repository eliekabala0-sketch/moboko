import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseResilientFetch } from "@/lib/supabase/resilient-fetch";

/**
 * Résout l’utilisateur pour une Route Handler : Bearer (mobile) ou cookies (web).
 */
export async function getUserFromApiRequest(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return { user: null as null, error: new Error("Supabase URL/anon manquants") };
  }

  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const client = createClient(url, anon, {
      global: {
        headers: { Authorization: bearer },
        fetch: supabaseResilientFetch,
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    return { user, error };
  }

  const cookieStore = await cookies();
  const client = createServerClient(url, anon, {
    global: { fetch: supabaseResilientFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* route API */
        }
      },
    },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  return { user, error };
}
