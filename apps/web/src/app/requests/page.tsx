import { Masthead } from "@/components/layout/Masthead";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

async function submitPrayerRequest(formData: FormData) {
  "use server";
  const requestText = String(formData.get("request_text") ?? "").trim();
  if (requestText.length < 3) redirect("/requests?error=empty");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/requests?error=service");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("prayer_requests").insert({
    user_id: user?.id ?? null,
    name: String(formData.get("name") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    request_text: requestText,
  });
  redirect(error ? "/requests?error=submit" : "/requests?sent=1");
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Priere
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
          Requêtes de prière
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Envoyez une requête à l&apos;équipe. Elle sera traitée avec discrétion.
        </p>
        {sp.sent ? (
          <p className="moboko-card mt-6 border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-sm text-[var(--success)]">
            Requête envoyée.
          </p>
        ) : null}
        {sp.error ? (
          <p className="moboko-card mt-6 border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
            Envoi impossible pour le moment.
          </p>
        ) : null}
        <form action={submitPrayerRequest} className="moboko-card mt-8 space-y-4 p-6">
          <input name="name" className="moboko-input" placeholder="Nom (optionnel)" />
          <input name="email" type="email" className="moboko-input" placeholder="Email (optionnel)" />
          <textarea
            name="request_text"
            required
            minLength={3}
            rows={7}
            className="moboko-input min-h-36 resize-y"
            placeholder="Votre requête"
          />
          <button type="submit" className="moboko-btn-primary px-6 py-3 text-sm">
            Envoyer
          </button>
        </form>
      </main>
    </div>
  );
}
