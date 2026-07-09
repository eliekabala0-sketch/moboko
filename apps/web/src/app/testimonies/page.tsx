import { Masthead } from "@/components/layout/Masthead";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

async function submitTestimony(formData: FormData) {
  "use server";
  const title = String(formData.get("title") ?? "").trim();
  const testimonyText = String(formData.get("testimony_text") ?? "").trim();
  if (title.length < 2 || testimonyText.length < 3) redirect("/testimonies?error=empty");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/testimonies?error=service");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("testimonies").insert({
    user_id: user?.id ?? null,
    name: String(formData.get("name") ?? "").trim() || null,
    title,
    testimony_text: testimonyText,
  });
  redirect(error ? "/testimonies?error=submit" : "/testimonies?sent=1");
}

export default async function TestimoniesPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data } = supabase
    ? await supabase
        .from("testimonies")
        .select("id, name, title, testimony_text, created_at")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Témoignages
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
          Témoignages
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Partagez un témoignage. Il sera publié après validation.
        </p>
        {sp.sent ? (
          <p className="moboko-card mt-6 border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-sm text-[var(--success)]">
            Témoignage reçu.
          </p>
        ) : null}
        {sp.error ? (
          <p className="moboko-card mt-6 border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
            Envoi impossible pour le moment.
          </p>
        ) : null}
        <form action={submitTestimony} className="moboko-card mt-8 space-y-4 p-6">
          <input name="name" className="moboko-input" placeholder="Nom (optionnel)" />
          <input name="title" required minLength={2} className="moboko-input" placeholder="Titre" />
          <textarea
            name="testimony_text"
            required
            minLength={3}
            rows={7}
            className="moboko-input min-h-36 resize-y"
            placeholder="Votre témoignage"
          />
          <button type="submit" className="moboko-btn-primary px-6 py-3 text-sm">
            Envoyer
          </button>
        </form>
        <section className="mt-12 space-y-3">
          {(data ?? []).map((t) => (
            <article key={t.id} className="moboko-card p-5">
              <h2 className="font-semibold text-[var(--foreground)]">{t.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                {t.testimony_text}
              </p>
              {t.name ? <p className="mt-3 text-xs text-[var(--accent)]">{t.name}</p> : null}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
