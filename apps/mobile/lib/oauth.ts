import { supabase } from "./supabase";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

function parseCallbackUrl(url: string): URL | null {
  try {
    const normalized = url.startsWith("moboko:")
      ? url.replace(/^moboko:\/\/?/, "https://x/")
      : url;
    return new URL(normalized);
  } catch {
    return null;
  }
}

export async function signInWithOAuthProvider(
  provider: "google" | "apple",
): Promise<{ error?: string }> {
  const redirectTo = makeRedirectUri({
    scheme: "moboko",
    path: "auth/callback",
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) return { error: error.message };
  if (!data.url) return { error: "URL d’authentification indisponible." };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, {
    preferEphemeralSession: true,
  });

  if (result.type === "cancel") return { error: undefined };
  if (result.type !== "success") {
    return { error: "La connexion n’a pas pu aboutir." };
  }

  return applyAuthCallbackUrl(result.url);
}

async function applyAuthCallbackUrl(url: string): Promise<{ error?: string }> {
  const parsed = parseCallbackUrl(url);
  if (!parsed) return { error: "Réponse d’authentification invalide." };

  const code = parsed.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return { error: error.message };
    return {};
  }

  const hash = parsed.hash?.replace(/^#/, "") ?? "";
  const hashParams = new URLSearchParams(hash);
  const access_token = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    if (error) return { error: error.message };
    return {};
  }

  const desc =
    parsed.searchParams.get("error_description") || parsed.searchParams.get("error");
  if (desc) return { error: decodeURIComponent(desc.replace(/\+/g, " ")) };

  return { error: "Réponse d’authentification incomplète." };
}
