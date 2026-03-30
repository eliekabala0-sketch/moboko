"use client";

import Link from "next/link";
import { useState } from "react";

type SearchResult = {
  slug: string;
  title: string;
  year: number | null;
  paragraph_number: number;
  excerpt: string;
  read_href: string;
  project_href: string;
  note: string | null;
};

type Props = {
  enabled: boolean;
  creditCost: number;
};

type ErrAction = "credits" | "auth" | null;

export function SermonAiSearchPanel({ enabled, creditCost }: Props) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errAction, setErrAction] = useState<ErrAction>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [billingLine, setBillingLine] = useState<string | null>(null);
  const [hasSearchedOk, setHasSearchedOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setErrAction(null);
    setSummary(null);
    setBillingLine(null);
    setHasSearchedOk(false);
    const q = query.trim();
    if (q.length < 8) {
      setErr("Saisissez au moins 8 caractères pour décrire ce que vous cherchez.");
      setErrAction(null);
      return;
    }
    setPending(true);
    setResults([]);
    try {
      const res = await fetch("/api/ai/sermons-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        if (res.status === 401) {
          setErr("Connectez-vous pour utiliser la recherche assistée par IA.");
          setErrAction("auth");
        } else if (res.status === 402) {
          const msg = typeof data.message === "string" ? data.message : "Crédits insuffisants.";
          setErr(msg);
          setErrAction("credits");
        } else if (res.status === 403) {
          setErr("La recherche IA sur les sermons est désactivée pour le moment.");
          setErrAction(null);
        } else {
          const detail =
            typeof data.detail === "string"
              ? data.detail
              : typeof data.error === "string"
                ? data.error
                : "Une erreur est survenue.";
          setErr(detail);
          setErrAction(null);
        }
        return;
      }

      const list = data.results;
      if (!Array.isArray(list)) {
        setErr("Réponse inattendue du serveur.");
        setErrAction(null);
        return;
      }
      setResults(list as SearchResult[]);
      setHasSearchedOk(true);

      let sum =
        typeof data.summary === "string" && data.summary.trim() ? data.summary.trim() : null;
      const hint = typeof data.hint === "string" ? data.hint : null;
      if (list.length === 0 && hint && !sum) {
        sum = hint;
      }
      setSummary(sum);

      const charged = Number(data.credits_charged);
      const cost = Number(data.credit_cost);
      const after = data.balance_after;
      if (data.billing_skipped) {
        setBillingLine(null);
      } else if (Number.isFinite(charged) && charged > 0 && Number.isFinite(cost)) {
        setBillingLine(
          typeof after === "number"
            ? `−${charged} crédit${charged > 1 ? "s" : ""} · solde ${after}`
            : `−${charged} crédit${charged > 1 ? "s" : ""}`,
        );
      } else if (Number.isFinite(cost) && cost === 0) {
        setBillingLine("Pas de débit de crédits pour cette recherche.");
      }
    } catch {
      setErr("Réseau indisponible. Réessayez dans un instant.");
      setErrAction(null);
    } finally {
      setPending(false);
    }
  }

  if (!enabled) {
    return (
      <section className="moboko-card mt-8 border-[var(--border)] p-6 sm:p-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Recherche intelligente
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          L’assistant de recherche en langage naturel est désactivé côté administration. Utilisez la{" "}
          <a href="#filtres-sermons" className="text-[var(--accent)] underline-offset-4 hover:underline">
            recherche plein texte
          </a>{" "}
          ci-dessus pour interroger les paragraphes.
        </p>
      </section>
    );
  }

  const showResultsBlock = hasSearchedOk;
  const showEmptyOk = hasSearchedOk && results.length === 0;

  return (
    <section className="moboko-card mt-8 p-6 sm:p-7">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
        Recherche intelligente
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        Décrivez en français ce que vous cherchez (thème, idée, contexte). L’IA classe des extraits déjà présents dans la
        base ; les liens ouvrent la lecture ou la projection sur le bon paragraphe.
        {creditCost > 0 ? (
          <>
            {" "}
            <span className="text-[var(--foreground)]">Coût : {creditCost} crédit{creditCost > 1 ? "s" : ""}</span> par
            recherche (hors comptes premium / accès offert).
          </>
        ) : (
          <> Recherche sans débit de crédits pour l’instant.</>
        )}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--muted)] opacity-90">
        Astuce : mentionnez un titre de sermon ou des mots du fond pour aider le moteur à proposer des extraits pertinents.
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-[var(--foreground)]">
          <span className="text-[var(--muted)]">Votre question</span>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder='Ex. Dans le sermon sur l’Enlèvement, où le prophète explique le rôle de l’Église ?'
            className="moboko-input mt-2 min-h-[5.5rem] resize-y"
            disabled={pending}
            aria-describedby="sermon-ai-hint"
          />
        </label>
        <p id="sermon-ai-hint" className="sr-only">
          Minimum 8 caractères. Connexion requise. Les crédits sont débités après réponse de l’IA lorsque la fonction est
          payante.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="moboko-btn-primary px-6 py-3 text-[14px] disabled:opacity-50"
          >
            {pending ? "Recherche…" : "Rechercher avec l’IA"}
          </button>
          {billingLine ? (
            <span className="text-xs text-[var(--muted)]" role="status">
              {billingLine}
            </span>
          ) : null}
        </div>
      </form>

      {err && errAction === "credits" ? (
        <div
          className="mt-6 rounded-xl border border-[var(--warning)]/35 bg-[var(--warning-soft)] p-5"
          role="alert"
        >
          <p className="text-sm font-medium text-[var(--foreground)]">{err}</p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Rechargez votre solde ou envisagez un abonnement pour utiliser la recherche IA sans interruption.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/billing?from=sermons-ai#credits"
              className="moboko-btn-primary inline-flex px-6 py-3 text-center text-[14px]"
            >
              Acheter des crédits
            </Link>
            <Link
              href="/billing?from=sermons-ai#abonnements"
              className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)]/40"
            >
              Voir les abonnements
            </Link>
          </div>
        </div>
      ) : null}

      {err && errAction === "auth" ? (
        <div
          className="mt-6 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] p-5"
          role="alert"
        >
          <p className="text-sm text-[var(--foreground)]">{err}</p>
          <Link
            href="/auth?next=%2Fsermons%23recherche-ia"
            className="moboko-btn-primary mt-4 inline-flex px-6 py-3 text-[14px]"
          >
            Se connecter
          </Link>
        </div>
      ) : null}

      {err && !errAction ? (
        <p
          className="mt-6 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
        >
          {err}
        </p>
      ) : null}

      {showResultsBlock ? (
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Résultats (IA)</h2>
          {showEmptyOk ? (
            <div className="moboko-card mt-4 p-6">
              <p className="text-sm leading-relaxed text-[var(--foreground)]">
                Aucun passage n’a été mis en avant pour cette question.
              </p>
              {summary ? (
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{summary}</p>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                  Essayez la recherche plein texte plus haut avec des mots présents dans les sermons, ou reformulez avec
                  le titre du sermon et un thème précis.
                </p>
              )}
            </div>
          ) : (
            <>
              {summary ? (
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{summary}</p>
              ) : null}
              <ul className="mt-4 space-y-3">
                {results.map((r) => (
                  <li key={`${r.slug}-${r.paragraph_number}`}>
                    <div className="moboko-card p-5 transition hover:border-[var(--border-strong)]">
                      <p className="font-medium text-[var(--foreground)]">{r.title}</p>
                      <p className="mt-1 text-xs text-[var(--accent)]">
                        Paragraphe [{r.paragraph_number}]
                        {r.year != null ? ` · ${r.year}` : ""}
                      </p>
                      {r.note ? (
                        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                          <span className="font-medium text-[var(--foreground)]/90">Pourquoi ce passage : </span>
                          {r.note}
                        </p>
                      ) : null}
                      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{r.excerpt}</p>
                      <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
                        <Link href={r.read_href} className="text-[var(--accent)] hover:underline">
                          Lire (ancre)
                        </Link>
                        <Link href={r.project_href} className="text-[var(--foreground)] hover:underline">
                          Projection
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
