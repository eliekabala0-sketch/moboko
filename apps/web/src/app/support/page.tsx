import { Masthead } from "@/components/layout/Masthead";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

async function submitSupportMessage(formData: FormData) {
  "use server";
  const message = String(formData.get("message") ?? "").trim();
  if (message.length < 3) redirect("/support?error=empty");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/support?error=service");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("support_messages").insert({
    user_id: user?.id ?? null,
    name: String(formData.get("name") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    subject: String(formData.get("subject") ?? "").trim() || null,
    message,
  });
  redirect(error ? "/support?error=submit" : "/support?sent=1");
}

export default async function SupportPage({
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
          Soutien
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
          Soutenir Moboko
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Pour l&apos;abonnement, les crédits IA ou le téléchargement PDF, utilisez l&apos;espace abonnement.
        </p>
        <Link href="/billing" className="moboko-btn-primary mt-6 inline-flex px-6 py-3 text-sm">
          Abonnement et crédits
        </Link>
        {sp.sent ? (
          <p className="moboko-card mt-6 border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-sm text-[var(--success)]">
            Message envoyé.
          </p>
        ) : null}
        {sp.error ? (
          <p className="moboko-card mt-6 border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
            Envoi impossible pour le moment.
          </p>
        ) : null}
        <form action={submitSupportMessage} className="moboko-card mt-8 space-y-4 p-6">
          <input name="name" className="moboko-input" placeholder="Nom (optionnel)" />
          <input name="email" type="email" className="moboko-input" placeholder="Email (optionnel)" />
          <input name="subject" className="moboko-input" placeholder="Sujet (optionnel)" />
          <textarea
            name="message"
            required
            minLength={3}
            rows={7}
            className="moboko-input min-h-36 resize-y"
            placeholder="Votre message"
          />
          <button type="submit" className="moboko-btn-primary px-6 py-3 text-sm">
            Envoyer
          </button>
        </form>
      </main>
    </div>
  );
}
