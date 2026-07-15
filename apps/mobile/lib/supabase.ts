import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Client Supabase partagé (même projet que le web).
 * AsyncStorage ne contient que la session Auth (tokens JWT) : compte, profil, crédits,
 * conversations et messages sont toujours lus/écrits dans Supabase (source de vérité).
 */
export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export function isSupabaseConfigured(): boolean {
  return Boolean(url.trim() && key.trim());
}
