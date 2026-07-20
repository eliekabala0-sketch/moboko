"use client";

import type { ReactNode } from "react";

type ServerAction = (formData: FormData) => void | Promise<void>;

type Plan = {
  id?: string;
  plan_key?: string | null;
  name?: string | null;
  description?: string | null;
  user_visible_text?: string | null;
  price?: number | null;
  currency?: string | null;
  duration_days?: number | null;
  monthly_ai_credits?: number | null;
  export_limit?: number | null;
  normal_search_unlimited?: boolean | null;
  pdf_allowed?: boolean | null;
  audio_streaming?: boolean | null;
  audio_offline_in_app?: boolean | null;
  audio_full_download?: boolean | null;
  audio_search?: boolean | null;
  is_active?: boolean | null;
  is_featured?: boolean | null;
  display_order?: number | null;
};

type Pack = {
  id?: string;
  pack_key?: string | null;
  name?: string | null;
  description?: string | null;
  credits?: number | null;
  bonus_credits?: number | null;
  price?: number | null;
  currency?: string | null;
  is_active?: boolean | null;
  is_featured?: boolean | null;
  display_order?: number | null;
};

function field(label: string, help: string, input: ReactNode) {
  return (
    <label className="text-sm font-medium text-[var(--foreground)]">
      <span>{label}</span>
      <span className="mt-1 block text-xs font-normal leading-relaxed text-[var(--muted)]">{help}</span>
      <span className="mt-2 block">{input}</span>
    </label>
  );
}

function confirmPlan(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price") ?? 0);
  const currency = String(formData.get("currency") ?? "USD").trim().toUpperCase() || "USD";
  const days = Number(formData.get("duration_days") ?? 0);
  const credits = Number(formData.get("monthly_ai_credits") ?? 0);
  const warning = price > 500 ? "\n\nAttention: prix inhabituel pour un abonnement." : "";
  return window.confirm(
    `Confirmer ce plan ?\n\nNom: ${name}\nPrix: ${price} ${currency}\nDuree: ${days} jours\nCredits IA mensuels: ${credits}${warning}`,
  );
}

function confirmPack(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price") ?? 0);
  const currency = String(formData.get("currency") ?? "USD").trim().toUpperCase() || "USD";
  const credits = Number(formData.get("credits") ?? 0);
  const bonus = Number(formData.get("bonus_credits") ?? 0);
  const warning = price > 500 ? "\n\nAttention: prix inhabituel pour un pack de credits." : "";
  return window.confirm(
    `Confirmer ce pack ?\n\nNom: ${name}\nCredits achetes: ${credits}\nBonus: ${bonus}\nTotal credite: ${credits + bonus}\nPrix: ${price} ${currency}${warning}`,
  );
}

export function SubscriptionPlanForm({
  plan,
  index,
  action,
}: {
  plan: Plan | null;
  index: number;
  action: ServerAction;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirmPlan(new FormData(event.currentTarget))) event.preventDefault();
      }}
      className="moboko-card grid gap-4 p-4 text-sm md:grid-cols-4"
    >
      <input type="hidden" name="id" defaultValue={plan?.id ?? ""} />
      {field(
        "Nom public",
        "Exemple: Mensuel, Annuel, Famille.",
        <input name="name" className="moboko-input" placeholder="Mensuel" defaultValue={plan?.name ?? ""} required />,
      )}
      {field(
        "Prix",
        "Montant exact envoye au paiement.",
        <input name="price" className="moboko-input" type="number" min={1} step={1} defaultValue={plan?.price ?? ""} required />,
      )}
      {field(
        "Devise",
        "Code en 3 lettres. Exemple: USD.",
        <input name="currency" className="moboko-input" defaultValue={plan?.currency ?? "USD"} />,
      )}
      {field(
        "Duree",
        "Nombre de jours d'acces pour ce plan.",
        <input name="duration_days" className="moboko-input" type="number" min={1} step={1} defaultValue={plan?.duration_days ?? 30} />,
      )}
      {field(
        "Cle interne",
        "Stable pour les webhooks. Laisser vide seulement pour auto-generer.",
        <input name="plan_key" className="moboko-input" placeholder="monthly" defaultValue={plan?.plan_key ?? ""} />,
      )}
      {field(
        "Credits IA mensuels",
        "Credits offerts avec l'abonnement, 0 si aucun.",
        <input name="monthly_ai_credits" className="moboko-input" type="number" min={0} step={1} defaultValue={plan?.monthly_ai_credits ?? 0} />,
      )}
      {field(
        "Limite PDF",
        "0 ou vide si aucune limite specifique.",
        <input name="export_limit" className="moboko-input" type="number" min={0} step={1} defaultValue={plan?.export_limit ?? ""} />,
      )}
      {field(
        "Ordre",
        "Plus petit = affiche plus haut.",
        <input name="display_order" className="moboko-input" type="number" min={0} step={1} defaultValue={plan?.display_order ?? index + 10} />,
      )}
      <label className="text-sm font-medium text-[var(--foreground)] md:col-span-2">
        Description admin
        <span className="mt-1 block text-xs font-normal leading-relaxed text-[var(--muted)]">Note courte pour reconnaitre l&apos;offre.</span>
        <textarea name="description" className="moboko-input mt-2" rows={2} defaultValue={plan?.description ?? ""} />
      </label>
      <label className="text-sm font-medium text-[var(--foreground)] md:col-span-2">
        Texte visible utilisateur
        <span className="mt-1 block text-xs font-normal leading-relaxed text-[var(--muted)]">Phrase affichee sur la page abonnement.</span>
        <textarea name="user_visible_text" className="moboko-input mt-2" rows={2} defaultValue={plan?.user_visible_text ?? ""} />
      </label>
      <label className="text-sm font-medium text-[var(--foreground)] md:col-span-4">
        Avantages
        <span className="mt-1 block text-xs font-normal leading-relaxed text-[var(--muted)]">Un avantage par ligne. Exemple: Recherche normale illimitee.</span>
        <textarea name="benefits" className="moboko-input mt-2" rows={2} defaultValue="" />
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="normal_search_unlimited" type="checkbox" defaultChecked={plan?.normal_search_unlimited ?? true} />
        Recherche illimitee
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="pdf_allowed" type="checkbox" defaultChecked={plan?.pdf_allowed ?? true} />
        PDF autorise
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="audio_streaming" type="checkbox" defaultChecked={plan?.audio_streaming ?? false} />
        Ecoute audio
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="audio_offline_in_app" type="checkbox" defaultChecked={plan?.audio_offline_in_app ?? false} />
        Hors connexion Moboko
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="audio_full_download" type="checkbox" defaultChecked={plan?.audio_full_download ?? false} />
        Telechargement fichier
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="audio_search" type="checkbox" defaultChecked={plan?.audio_search ?? false} />
        Recherche audio
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="is_featured" type="checkbox" defaultChecked={plan?.is_featured ?? false} />
        Mis en avant
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="is_active" type="checkbox" defaultChecked={plan?.is_active ?? true} />
        Actif
      </label>
      <button type="submit" className="moboko-btn-primary px-4 py-2 text-sm md:col-span-4">
        {plan ? "Enregistrer ce plan" : "Ajouter le plan"}
      </button>
    </form>
  );
}

export function CreditPackForm({
  pack,
  index,
  action,
}: {
  pack: Pack | null;
  index: number;
  action: ServerAction;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirmPack(new FormData(event.currentTarget))) event.preventDefault();
      }}
      className="moboko-card grid gap-4 p-4 text-sm md:grid-cols-4"
    >
      <input type="hidden" name="id" defaultValue={pack?.id ?? ""} />
      {field(
        "Nom public",
        "Exemple: Pack 20, Pack mission.",
        <input name="name" className="moboko-input" placeholder="Pack 20" defaultValue={pack?.name ?? ""} required />,
      )}
      {field(
        "Credits achetes",
        "Nombre de credits garantis.",
        <input name="credits" className="moboko-input" type="number" min={1} step={1} defaultValue={pack?.credits ?? ""} required />,
      )}
      {field(
        "Bonus",
        "Credits supplementaires offerts, 0 si aucun.",
        <input name="bonus_credits" className="moboko-input" type="number" min={0} step={1} defaultValue={pack?.bonus_credits ?? 0} />,
      )}
      {field(
        "Prix",
        "Montant exact envoye au paiement.",
        <input name="price" className="moboko-input" type="number" min={1} step={1} defaultValue={pack?.price ?? ""} required />,
      )}
      {field(
        "Devise",
        "Code en 3 lettres. Exemple: USD.",
        <input name="currency" className="moboko-input" defaultValue={pack?.currency ?? "USD"} />,
      )}
      {field(
        "Cle interne",
        "Stable pour les webhooks. Laisser vide seulement pour auto-generer.",
        <input name="pack_key" className="moboko-input" placeholder="credits-20" defaultValue={pack?.pack_key ?? ""} />,
      )}
      {field(
        "Ordre",
        "Plus petit = affiche plus haut.",
        <input name="display_order" className="moboko-input" type="number" min={0} step={1} defaultValue={pack?.display_order ?? index + 10} />,
      )}
      <label className="text-sm font-medium text-[var(--foreground)] md:col-span-4">
        Description
        <span className="mt-1 block text-xs font-normal leading-relaxed text-[var(--muted)]">Texte court affiche pour comprendre le pack.</span>
        <textarea name="description" className="moboko-input mt-2" rows={2} defaultValue={pack?.description ?? ""} />
      </label>
      <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)] md:col-span-4">
        Le total credite sera: credits achetes + bonus. Verifiez le resume de confirmation avant sauvegarde.
      </p>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="is_featured" type="checkbox" defaultChecked={pack?.is_featured ?? false} />
        Mis en avant
      </label>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input name="is_active" type="checkbox" defaultChecked={pack?.is_active ?? true} />
        Actif
      </label>
      <button type="submit" className="moboko-btn-primary px-4 py-2 text-sm md:col-span-4">
        {pack ? "Enregistrer ce pack" : "Ajouter le pack"}
      </button>
    </form>
  );
}

