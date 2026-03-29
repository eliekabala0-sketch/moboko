import { createClient } from "@supabase/supabase-js";
import { supabaseResilientFetch } from "@/lib/supabase/resilient-fetch";

/**
 * Client service_role — uniquement dans les routes API / serveur.
 * Ne jamais importer dans un composant client ou une route exposant la clé.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: supabaseResilientFetch },
  });
}
