"use client";

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

function friendlyAuthError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "E-mail ou mot de passe incorrect.";
  }
  if (lower.includes("email not confirmed")) return "Compte indisponible pour le moment. Reessayez ou contactez le soutien Moboko.";
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
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");

  const redirectAfterAuth = safeInternalPath(searchParams.get("next"));

  useEffect(() => {
    const err = searchParams.get("error");
    if (err === "oauth") setError("Cette methode de connexion est indisponible pour le moment.");
    else if (err === "config") setError("Connexion indisponible pour le moment.");
  }, [searchParams]);

  const supabase = useCallback(() => createSupabaseBrowserClient(), []);
  const busy = loading !== null;

  async function resolveIdentifier() {
    const res = await fetch("/api/auth/resolve-identifier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    const data = (await res.json()) as { authEmail?: string; error?: string };
    if (!res.ok || !data.authEmail) {
      throw new Error(data.error === "numero_invalide" ? "Le numero de telephone n'est pas valide." : "Indiquez un email ou un numero valide.");
    }
    return data.authEmail;
  }

  async function submitPassword() {
    setError(null);
    setInfo(null);
    if (!identifier.trim()) {
      setError("Indiquez votre email ou votre numero de telephone.");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caracteres.");
      return;
    }
    if (mode === "signup" && (!fullName.trim() || !sex.trim() || !city.trim() || !age.trim())) {
      setError("Completez les informations d'inscription.");
      return;
    }
    setLoading("email");
    try {
      let authEmail = "";
      if (mode === "signin") {
        authEmail = await resolveIdentifier();
        const { error: sErr } = await supabase().auth.signInWithPassword({ email: authEmail, password });
        if (sErr) {
          setError(friendlyAuthError(sErr.message));
          return;
        }
        router.refresh();
        router.push(redirectAfterAuth ?? "/");
      } else {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, password, fullName, sex, city, age }),
        });
        const created = (await res.json()) as { authEmail?: string; message?: string };
        if (!res.ok || !created.authEmail) {
          setError(created.message ?? "Le compte n'a pas pu etre cree.");
          return;
        }
        authEmail = created.authEmail;
        const { error: sErr } = await supabase().auth.signInWithPassword({ email: authEmail, password });
        if (sErr) {
          setError(friendlyAuthError(sErr.message));
          return;
        }
        router.refresh();
        router.push(redirectAfterAuth ?? "/");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion indisponible pour le moment.");
    } finally {
      setLoading(null);
    }
  }

  async function sendPasswordReset() {
    setError(null);
    setInfo(null);
    setInfo("Pour recuperer votre acces, contactez le soutien Moboko avec votre email ou numero.");
  }

  return (
    <div className="moboko-card mx-auto w-full max-w-md space-y-6 p-8 sm:p-9">
      <div className="space-y-3">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
          Connexion
        </p>
        <p className="text-center text-sm leading-relaxed text-[var(--muted)]">
          Utilisez votre email ou votre numero de telephone avec votre mot de passe.
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

        {mode === "signup" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="moboko-input" placeholder="Nom complet" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} autoComplete="name" />
            <input className="moboko-input" placeholder="Ville" value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} autoComplete="address-level2" />
            <select className="moboko-input" value={sex} onChange={(e) => setSex(e.target.value)} disabled={busy}>
              <option value="">Sexe</option>
              <option value="femme">Femme</option>
              <option value="homme">Homme</option>
            </select>
            <input className="moboko-input" type="number" inputMode="numeric" min={10} max={120} placeholder="Age" value={age} onChange={(e) => setAge(e.target.value)} disabled={busy} />
          </div>
        ) : null}
        <label className="block text-sm font-medium text-[var(--foreground)]">
          <span className="text-[var(--muted)]">Email ou numero de telephone</span>
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
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
          disabled={busy || !identifier.trim() || password.length < 6}
          onClick={() => void submitPassword()}
          className="moboko-btn-primary w-full py-3.5 text-[15px] disabled:opacity-45"
        >
          {loading === "email" ? "Patientez..." : mode === "signin" ? "Se connecter" : "Creer le compte"}
        </button>
        {mode === "signin" ? (
          <button
            type="button"
            disabled={busy || !identifier.trim()}
            onClick={() => void sendPasswordReset()}
            className="w-full text-center text-sm font-medium text-[var(--accent)] disabled:opacity-45"
          >
            {loading === "reset" ? "Envoi..." : "Mot de passe oublie ?"}
          </button>
        ) : null}
      </div>

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
