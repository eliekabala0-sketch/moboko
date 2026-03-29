"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setInfo(null);
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "signin") {
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signErr) {
          setError(signErr.message);
          return;
        }
      } else {
        const { error: signErr } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signErr) {
          setError(signErr.message);
          return;
        }
        setInfo(
          "Compte créé. Si la confirmation e-mail est activée sur le projet, vérifiez votre boîte.",
        );
      }
      router.refresh();
      if (mode === "signin") {
        router.push("/");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de configuration.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="moboko-card mx-auto w-full max-w-md space-y-8 p-8 sm:p-9">
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

      <div className="space-y-5">
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
      </div>

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

      <button
        type="button"
        disabled={loading || !email.trim() || password.length < 6}
        onClick={() => void submit()}
        className="moboko-btn-primary w-full py-3.5 text-[15px]"
      >
        {loading ? "Patientez…" : mode === "signin" ? "Se connecter" : "Créer le compte"}
      </button>

      <p className="text-center text-xs leading-relaxed text-[var(--muted)]">
        Authentification Supabase — mêmes comptes que sur l’app mobile.
      </p>
    </div>
  );
}
