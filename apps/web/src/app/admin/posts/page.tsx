import { createPostAction, publishPostAction } from "@/app/admin/posts/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminPostsPage() {
  const supabase = await createSupabaseServerClient();
  let data: {
    id: string;
    title: string | null;
    slug: string | null;
    status: string | null;
    post_type?: string | null;
    priority?: string | null;
    scheduled_at?: string | null;
    notify_on_publish?: boolean | null;
    notification_sent_at?: string | null;
    published_at: string | null;
    updated_at: string | null;
  }[] = [];
  let notificationsSchemaReady = false;
  if (supabase) {
    const rich = await supabase
      .from("posts")
      .select("id, title, slug, status, post_type, priority, scheduled_at, notify_on_publish, notification_sent_at, published_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (!rich.error) {
      data = rich.data ?? [];
      notificationsSchemaReady = true;
    } else {
      const legacy = await supabase
        .from("posts")
        .select("id, title, slug, status, published_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      data = legacy.data ?? [];
    }
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        Admin
      </p>
      <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
        Publications
      </h1>

      {notificationsSchemaReady ? (
        <form action={createPostAction} className="moboko-card mt-8 grid gap-4 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <select name="post_type" className="moboko-input">
              <option value="publication">Publication</option>
              <option value="announcement">Annonce</option>
              <option value="mass_message">Message de masse</option>
            </select>
            <select name="priority" className="moboko-input">
              <option value="normal">Priorite normale</option>
              <option value="high">Priorite elevee</option>
            </select>
            <select name="status" className="moboko-input">
              <option value="draft">Brouillon</option>
              <option value="published">Publier maintenant</option>
            </select>
          </div>
          <input name="title" required minLength={2} className="moboko-input" placeholder="Titre" />
          <textarea name="excerpt" className="moboko-input min-h-20 resize-y" placeholder="Resume court" />
          <textarea name="body" required minLength={3} className="moboko-input min-h-40 resize-y" placeholder="Contenu" />
          <div className="grid gap-3 md:grid-cols-2">
            <input name="scheduled_at" type="datetime-local" className="moboko-input" />
            <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
              <input name="notify_on_publish" type="checkbox" />
              Envoyer une notification Push a la publication
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input name="notification_title" className="moboko-input" placeholder="Titre notification" />
            <input name="notification_body" className="moboko-input" placeholder="Texte notification" />
          </div>
          <button className="moboko-btn-primary w-fit px-5 py-2 text-sm">Enregistrer</button>
        </form>
      ) : null}

      <div className="moboko-card mt-8 p-5">
        {(data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Aucune publication.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(data ?? []).map((post) => (
              <li key={post.id} className="py-4">
                <p className="font-medium text-[var(--foreground)]">{post.title}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {post.post_type ?? "publication"} - {post.priority ?? "normal"} - {post.status} - {post.slug}
                  {post.published_at ? ` - ${post.published_at}` : ""}
                  {post.scheduled_at ? ` - programme ${post.scheduled_at}` : ""}
                  {post.notification_sent_at ? " - notification envoyee" : ""}
                </p>
                {notificationsSchemaReady && post.status !== "published" ? (
                  <form action={publishPostAction} className="mt-3 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="id" value={post.id} />
                    <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <input name="notify" type="checkbox" defaultChecked={Boolean(post.notify_on_publish)} />
                      Notifier
                    </label>
                    <button className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold">
                      Publier maintenant
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
