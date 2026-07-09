import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminPostsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase
    ? await supabase
        .from("posts")
        .select("id, title, slug, status, published_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50)
    : { data: [] };

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Admin
      </p>
      <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
        Publications
      </h1>
      <div className="moboko-card mt-8 p-5">
        {(data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Aucune publication.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(data ?? []).map((post) => (
              <li key={post.id} className="py-4">
                <p className="font-medium text-[var(--foreground)]">{post.title}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {post.status} · {post.slug}
                  {post.published_at ? ` · ${post.published_at}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
