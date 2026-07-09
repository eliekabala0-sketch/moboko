import { Masthead } from "@/components/layout/Masthead";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PostsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase
    ? await supabase
        .from("posts")
        .select("id, title, excerpt, body, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(30)
    : { data: [] };

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Contenu
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
          Enseignements
        </h1>
        {(data ?? []).length === 0 ? (
          <p className="moboko-card mt-8 p-6 text-sm leading-relaxed text-[var(--muted)]">
            Aucun enseignement publié pour le moment.
          </p>
        ) : (
          <div className="mt-8 space-y-4">
            {(data ?? []).map((post) => (
              <article key={post.id} className="moboko-card p-5">
                <h2 className="font-display text-xl font-semibold text-[var(--foreground)]">
                  {post.title}
                </h2>
                {post.excerpt ? (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{post.excerpt}</p>
                ) : null}
                <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">
                  {post.body}
                </p>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
