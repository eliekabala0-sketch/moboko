"use client";

import { getSiteUrl } from "@/lib/auth/site-url";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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

function friendlyAuthError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "E-mail ou mot de passe incorrect.";
  }
  if (lower.includes("email not confirmed")) return "Confirmez votre e-mail avant de vous connecter.";
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Trop de tentatives. Reessayez dans quelques minutes.";
  }
  if (lower.includes("provider") || lower.includes("oauth")) {
    return "Cette methode de connexion est indisponible pour le moment.";
  }
  return "L'operation n'a pas pu aboutir. Verifiez les informations et reessayez.";
}

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phoneStep, setPhoneStep] = useState<"idle" | "sent">("idle");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");

  const redirectAfterAuth = safeInternalPath(searchParams.get("next"));
  const phoneAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_PHONE_AUTH === "true";
  const googleAuthEnabled =
    process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true" &&
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_CONFIGURED === "true";
  const appleAuthEnabled =
    process.env.NEXT_PUBLIC_ENABLE_APPLE_AUTH === "true" &&
    process.env.NEXT_PUBLIC_APPLE_AUTH_CONFIGURED === "true";
  const hasSecondaryAuth = phoneAuthEnabled || googleAuthEnabled || appleAuthEnabled;

  useEffect(() => {
    const err = searchParams.get("error");
    if (err === "oauth") setError("Cette methode de connexion est indisponible pour le moment.");
    else if (err === "config") setError("Connexion indisponible pour le moment.");
  }, [searchParams]);

  const supabase = useCallback(() => createSupabaseBrowserClient(), []);
  const busy = loading !== null;

  async function oauth(provider: "google" | "apple") {
    setError(null);
    setInfo(null);
    setLoading(provider);
    try {
      const { error: oErr } = await supabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${getSiteUrl()}/auth/callback` },
      });
      if (oErr) setError(friendlyAuthError(oErr.message));
    } finally {
      setLoading(null);
    }
  }

  async function submitEmailPassword() {
    setError(null);
    setInfo(null);
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Indiquez une adresse e-mail valide.");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caracteres.");
      return;
    }
    setLoading("email");
    try {
      if (mode === "signin") {
        const { error: sErr } = await supabase().auth.signInWithPassword({ email: cleanEmail, password });
        if (sErr) {
          setError(friendlyAuthError(sErr.message));
          return;
        }
        router.refresh();
        router.push(redirectAfterAuth ?? "/");
      } else {
        const { data, error: uErr } = await supabase().auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: `${getSiteUrl()}/auth` },
        });
        if (uErr) {
          setError(friendlyAuthError(uErr.message));
          return;
        }
        router.refresh();
        if (data.session) router.push(redirectAfterAuth ?? "/");
        else setInfo("Compte cree. Ouvrez le lien recu par e-mail si une confirmation est demandee.");
      }
    } finally {
      setLoading(null);
    }
  }

  async function sendPasswordReset() {
    setError(null);
    setInfo(null);
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Indiquez votre e-mail pour recevoir le lien.");
      return;
    }
    setLoading("reset");
    try {
      const { error: rErr } = await supabase().auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${getSiteUrl()}/auth`,
      });
      if (rErr) {
        setError(friendlyAuthError(rErr.message));
        return;
      }
      setInfo("Lien de recuperation envoye si ce compte existe.");
    } finally {
      setLoading(null);
    }
  }

  async function sendPhoneOtp() {
    setError(null);
    setInfo(null);
    const e164 = normalizeE164(phone);
    if (!e164.startsWith("+") || e164.length < 10) {
      setError("Indiquez le numero au format international.");
      return;
    }
    setLoading("phone-send");
    try {
      const { error: pErr } = await supabase().auth.signInWithOtp({ phone: e164, options: { channel: "sms" } });
      if (pErr) {
        setError(friendlyAuthError(pErr.message));
        return;
      }
      setPhone(e164);
      setPhoneStep("sent");
      setInfo("Code envoye par SMS.");
    } finally {
      setLoading(null);
    }
  }

  async function verifyPhoneOtp() {
    setError(null);
    setInfo(null);
    const code = otp.trim();
    if (code.length < 4) {
      setError("Saisissez le code recu par SMS.");
      return;
    }
    setLoading("phone-verify");
    try {
      const { error: vErr } = await supabase().auth.verifyOtp({
        phone: normalizeE164(phone),
        token: code,
        type: "sms",
      });
      if (vErr) {
        setError(friendlyAuthError(vErr.message));
        return;
      }
      router.refresh();
      router.push(redirectAfterAuth ?? "/");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="moboko-card mx-auto w-full max-w-md space-y-6 p-8 sm:p-9">
      <div className="space-y-3">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
          Connexion
        </p>
        <p className="text-center text-sm leading-relaxed text-[var(--muted)]">
          Utilisez votre e-mail et votre mot de passe pour acceder a Moboko.
        </p>
      </div>

      <div className="space-y-5">
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
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="moboko-input mt-2"
            disabled={busy}
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
            disabled={busy}
          />
        </label>
        <button
          type="button"
          disabled={busy || !email.trim() || password.length < 6}
          onClick={() => void submitEmailPassword()}
          className="moboko-btn-primary w-full py-3.5 text-[15px] disabled:opacity-45"
        >
          {loading === "email" ? "Patientez..." : mode === "signin" ? "Se connecter" : "Creer le compte"}
        </button>
        {mode === "signin" ? (
          <button
            type="button"
            disabled={busy || !email.trim()}
            onClick={() => void sendPasswordReset()}
            className="w-full text-center text-sm font-medium text-[var(--accent)] disabled:opacity-45"
          >
            {loading === "reset" ? "Envoi..." : "Mot de passe oublie ?"}
          </button>
        ) : null}
      </div>

      {hasSecondaryAuth ? (
        <div className="space-y-4 border-t border-[var(--border)] pt-5">
          {phoneAuthEnabled ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/50 p-5">
              <p className="text-sm font-semibold text-[var(--foreground)]">Telephone</p>
              {phoneStep === "idle" ? (
                <div className="mt-4 space-y-3">
                  <input
                    type="tel"
                    inputMode="tel"
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
                    className="moboko-btn-primary w-full py-3.5 text-[15px] disabled:opacity-45"
                  >
                    {loading === "phone-send" ? "Envoi..." : "Recevoir un code"}
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="Code SMS"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="moboko-input"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void verifyPhoneOtp()}
                    className="moboko-btn-primary w-full py-3.5 text-[15px] disabled:opacity-45"
                  >
                    {loading === "phone-verify" ? "Verification..." : "Valider le code"}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {googleAuthEnabled || appleAuthEnabled ? (
            <div className="flex flex-col gap-3">
              {googleAuthEnabled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void oauth("google")}
                  className="flex w-full items-center justify-center rounded-full border border-[var(--border)] bg-[#f8f9fb] py-3.5 text-[15px] font-semibold text-[#1f1f1f] shadow-sm transition hover:bg-white disabled:opacity-45"
                >
                  Continuer avec Google
                </button>
              ) : null}
              {appleAuthEnabled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void oauth("apple")}
                  className="flex w-full items-center justify-center rounded-full border border-[var(--border-strong)] bg-[#0a0a0a] py-3.5 text-[15px] font-semibold text-white shadow-sm transition hover:bg-[#141414] disabled:opacity-45"
                >
                  Continuer avec Apple
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-[var(--danger)]/35 bg-[var(--danger-soft)] px-4 py-3 text-sm leading-relaxed text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-relaxed text-[var(--muted)]" role="status">
          {info}
        </p>
      ) : null}
    </div>
  );
}
