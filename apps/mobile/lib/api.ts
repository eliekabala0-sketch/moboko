import { getApiBaseUrl } from "./auth-config";
import { supabase } from "./supabase";

export async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Session expiree. Reconnectez-vous.");
  return session.access_token;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.message ?? data.detail ?? data.error ?? `Erreur ${res.status}`);
  }
  return data as T;
}

export async function publicApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.message ?? data.detail ?? data.error ?? `Erreur ${res.status}`);
  }
  return data as T;
}
