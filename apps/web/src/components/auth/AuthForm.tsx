"use client";

import { getSiteUrl } from "@/lib/auth/site-url";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** Paramètre `next` : chemin interne uniquement (ex. /billing, /sermons#recherche-ia). */
function safeInternalPath(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return null;
  if (t.includes("://")) return null;
  return t;
}

function normalizeE164(raw: string): string {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return "";
  if (t.startsWith("+")) return t;
  if (t.startsWith("00")) return `+${t.slice(2)}`;
  return t;
}

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const [phoneStep, setPhoneStep] = useState<"idle" | "sent">("idle");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");

  const [emailExpanded, setEmailExpanded] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const redirectAfterAuth = safeInternalPath(searchParams.get("next"));

  useEffect(() => {
    const err = searchParams.get("error");
    const detail = searchParams.get("detail");
    if (err === "oauth") {
      setError(detail ? decodeURIComponent(detail) : "La connexion OAuth a échoué. Réessayez.");
    } else if (err === "config") {
      setError("Configuration Supabase incomplète côté serveur.");
    }
  }, [searchParams]);

  const supabase = useCallback(() => createSupabaseBrowserClient(), []);

  async function oauth(provider: "google" | "apple") {
    setError(null);
    setInfo(null);
    setLoading(provider);
    try {
      const redirectTo = `${getSiteUrl()}/auth/callback`;
      const { error: oErr } = await supabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (oErr) setError(oErr.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur OAuth.");
    } finally {
      setLoading(null);
    }
  }

  async function sendPhoneOtp() {
    setError(null);
    setInfo(null);
    const e164 = normalizeE164(phone);
    if (!e164.startsWith("+") || e164.length < 10) {
      setError("Indiquez le numéro au format international (ex. +33612345678).");
      return;
    }
    setLoading("phone-send");
    try {
      const { error: pErr } = await supabase().auth.signInWithOtp({
        phone: e164,
        options: { channel: "sms" },
      });
      if (pErr) {
        setError(pErr.message);
        return;
      }
      setPhone(e164);
      setPhoneStep("sent");
      setInfo("Code envoyé par SMS. Saisissez-le ci-dessous.");
    } finally {
      setLoading(null);
    }
  }

  async function verifyPhoneOtp() {
    setError(null);
    setInfo(null);
    const e164 = normalizeE164(phone);
    const code = otp.trim();
    if (code.length < 4) {
      setError("Saisissez le code reçu par SMS.");
      return;
    }
    setLoading("phone-verify");
    try {
      const { error: vErr } = await supabase().auth.verifyOtp({
        phone: e164,
        token: code,
        type: "sms",
      });
      if (vErr) {
        setError(vErr.message);
        return;
      }
      router.refresh();
      router.push(redirectAfterAuth ?? "/");
    } finally {
      setLoading(null);
    }
  }

  async function submitEmailPassword() {
    setError(null);
    setInfo(null);
    setLoading("email");
    const site = getSiteUrl();
    try {
      if (mode === "signin") {
        const { error: sErr } = await supabase().auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (sErr) {
          setError(sErr.message);
          return;
        }
        router.refresh();
        router.push(redirectAfterAuth ?? "/");
      } else {
        const { data, error: uErr } = await supabase().auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${site}/` },
        });
        if (uErr) {
          setError(uErr.message);
          return;
        }
        router.refresh();
        if (data.session) {
          router.push(redirectAfterAuth ?? "/");
        } else {
          setInfo(
            "Compte créé. Si une confirmation e-mail est activée sur le projet, ouvrez le lien reçu ; sinon connectez-vous.",
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setLoading(null);
    }
  }

  const busy = loading !== null;

  return (
    <div className="moboko-card mx-auto w-full max-w-md space-y-6 p-8 sm:p-9">
      <div className="space-y-3">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
          Connexion fluide
        </p>
        <p className="text-center text-sm leading-relaxed text-[var(--muted)]">
          Un même compte sur tous vos appareils — profil et historique conservés dans Supabase.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void oauth("google")}
          className="flex w-full items-center justify-center gap-3 rounded-full border border-[var(--border)] bg-[#f8f9fb] py-3.5 text-[15px] font-semibold text-[#1f1f1f] shadow-sm transition hover:bg-white disabled:opacity-45"
        >
          <GoogleGlyph />
          Continuer avec Google
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void oauth("apple")}
          className="flex w-full items-center justify-center gap-3 rounded-full border border-[var(--border-strong)] bg-[#0a0a0a] py-3.5 text-[15px] font-semibold text-white shadow-sm transition hover:bg-[#141414] disabled:opacity-45"
        >
          <AppleGlyph />
          Continuer avec Apple / iCloud
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/50 p-5">
        <p className="text-sm font-semibold text-[var(--foreground)]">Téléphone</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Numéro au format international (ex. +33…). Code par SMS.
        </p>
        {phoneStep === "idle" ? (
          <div className="mt-4 space-y-3">
            <input
              type="tel"
              autoComplete="tel"
              placeholder="+33 6 12 34 56 78"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="moboko-input"
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy || !phone.trim()}
              onClick={() => void sendPhoneOtp()}
              className="moboko-btn-primary w-full py-3.5 text-[15px]"
            >
              {loading === "phone-send" ? "Envoi…" : "Continuer avec téléphone"}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-[var(--muted)]">Code envoyé à {phone}</p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Code à 6 chiffres"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="moboko-input"
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void verifyPhoneOtp()}
              className="moboko-btn-primary w-full py-3.5 text-[15px]"
            >
              {loading === "phone-verify" ? "Vérification…" : "Valider le code"}
            </button>
            <button
              type="button"
              className="w-full text-center text-sm font-medium text-[var(--accent)]"
              onClick={() => {
                setPhoneStep("idle");
                setOtp("");
                setInfo(null);
              }}
            >
              Modifier le numéro
            </button>
          </div>
        )}
      </div>

      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--border)]" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-wider text-[var(--muted)]">
          <span className="bg-[linear-gradient(165deg,rgba(26,35,56,0.95),rgba(18,25,43,0.98))] px-3">
            Option secondaire
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setEmailExpanded((v) => !v)}
        className="w-full text-center text-sm font-medium text-[var(--accent)]"
      >
        {emailExpanded ? "Masquer e-mail et mot de passe" : "S’identifier avec e-mail et mot de passe"}
      </button>

      {emailExpanded ? (
        <div className="space-y-5 border-t border-[var(--border)] pt-5">
          <div className="flex gap-1 rounded-full border border-[var(--border)] bg-[var(--background)]/80 p-1 text-sm font-semibold">
            <button
              type="button"
              className={`flex-1 rounded-full py-2.5 transition ${
                mode === "signin"
                  ? "bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm ring-1 ring-[var(--border-strong)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setMode("signin")}
            >
              Connexion
            </button>
            <button
              type="button"
              className={`flex-1 rounded-full py-2.5 transition ${
                mode === "signup"
                  ? "bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm ring-1 ring-[var(--border-strong)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setMode("signup")}
            >
              Inscription
            </button>
          </div>
          <label className="block text-sm font-medium text-[var(--foreground)]">
            <span className="text-[var(--muted)]">E-mail</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="moboko-input mt-2"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--foreground)]">
            <span className="text-[var(--muted)]">Mot de passe</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="moboko-input mt-2"
            />
          </label>
          <button
            type="button"
            disabled={busy || !email.trim() || password.length < 6}
            onClick={() => void submitEmailPassword()}
            className="moboko-btn-primary w-full py-3.5 text-[15px]"
          >
            {loading === "email"
              ? "Patientez…"
              : mode === "signin"
                ? "Se connecter"
                : "Créer le compte"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p
          className="rounded-xl border border-[var(--danger)]/35 bg-[var(--danger-soft)] px-4 py-3 text-sm leading-relaxed text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {info ? (
        <p
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-relaxed text-[var(--muted)]"
          role="status"
        >
          {info}
        </p>
      ) : null}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="fill-current">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
