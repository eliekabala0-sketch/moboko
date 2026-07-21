import { Masthead } from "@/components/layout/Masthead";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import Link from "next/link";

type Props = {
  searchParams: Promise<{ type?: string }>;
};

type JournalItem = {
  id: string;
  type: "Publication" | "Annonce" | "Message" | "Requete de priere" | "Temoignage";
  typeKey: "publication" | "announcement" | "mass_message" | "prayer" | "testimony";
  title: string;
  body: string;
  author?: string | null;
  publishedAt: string;
  href: string;
  priority: number;
};

type PostRow = {
  id: string;
  title: string | null;
  excerpt?: string | null;
  body?: string | null;
  post_type?: string | null;
  priority?: string | null;
  published_at: string | null;
};

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

export default async function PostsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const selectedType = sp.type?.trim() ?? "";
  const supabase = createSupabaseServiceClient();
  const items: JournalItem[] = [];

  if (supabase) {
    const postsQuery = supabase
      .from("posts")
      .select("id, title, excerpt, body, post_type, priority, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(30);
    const [{ data: richPosts, error: postsError }, { data: prayers }, { data: testimonies }] = await Promise.all([
      postsQuery,
      supabase
        .from("prayer_requests")
        .select("id, name, request_text, updated_at, created_at")
        .eq("status", "reviewed")
        .eq("is_public", true)
        .order("updated_at", { ascending: false })
        .limit(30),
      supabase
        .from("testimonies")
        .select("id, name, title, testimony_text, updated_at, created_at")
        .eq("status", "published")
        .order("updated_at", { ascending: false })
        .limit(30),
    ]);
    const posts: PostRow[] | null = postsError
      ? (
          await supabase
            .from("posts")
            .select("id, title, excerpt, body, published_at")
            .eq("status", "published")
            .order("published_at", { ascending: false })
            .limit(30)
        ).data
      : richPosts;

    for (const post of posts ?? []) {
      const typeKey = String(post.post_type ?? "publication") as JournalItem["typeKey"];
      items.push({
        id: String(post.id),
        type: typeKey === "announcement" ? "Annonce" : typeKey === "mass_message" ? "Message" : "Publication",
        typeKey,
        title: String(post.title ?? "Publication"),
        body: String(post.excerpt || post.body || ""),
        publishedAt: String(post.published_at ?? new Date().toISOString()),
        href: `/posts#publication-${post.id}`,
        priority: 2,
      });
    }
    for (const prayer of prayers ?? []) {
      items.push({
        id: String(prayer.id),
        type: "Requete de priere",
        typeKey: "prayer",
        title: "Requete de priere",
        body: String(prayer.request_text ?? ""),
        author: prayer.name ? String(prayer.name) : null,
        publishedAt: String(prayer.updated_at ?? prayer.created_at ?? new Date().toISOString()),
        href: `/posts#prayer-${prayer.id}`,
        priority: 1,
      });
    }
    for (const testimony of testimonies ?? []) {
      items.push({
        id: String(testimony.id),
        type: "Temoignage",
        typeKey: "testimony",
        title: String(testimony.title ?? "Temoignage"),
        body: String(testimony.testimony_text ?? ""),
        author: testimony.name ? String(testimony.name) : null,
        publishedAt: String(testimony.updated_at ?? testimony.created_at ?? new Date().toISOString()),
        href: `/posts#testimony-${testimony.id}`,
        priority: 2,
      });
    }
  }

  const filtered = items
    .filter((item) => !selectedType || item.typeKey === selectedType)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const newPrayerCount = items.filter((item) => item.typeKey === "prayer").length;

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Journal
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--foreground)]">
          Journal
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Publications, requetes de priere validees et temoignages publies sont rassembles ici.
        </p>
        {newPrayerCount > 0 ? (
          <p className="moboko-card mt-6 border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4 text-sm font-semibold text-[var(--foreground)]">
            Nouvelle requete de priere publique disponible.
          </p>
        ) : null}

        <nav className="mt-8 flex flex-wrap gap-2 text-sm font-semibold">
          {[
            ["", "Tout"],
            ["publication", "Publications"],
            ["announcement", "Annonces"],
            ["mass_message", "Messages"],
            ["prayer", "Requetes"],
            ["testimony", "Temoignages"],
          ].map(([value, label]) => (
            <Link
              key={value}
              href={value ? `/posts?type=${value}` : "/posts"}
              className={`rounded-full border px-4 py-2 ${
                selectedType === value
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {filtered.length === 0 ? (
          <p className="moboko-card mt-8 p-6 text-sm leading-relaxed text-[var(--muted)]">
            Aucun contenu publie pour le moment.
          </p>
        ) : (
          <div className="mt-8 space-y-4">
            {filtered.map((item) => (
              <article key={`${item.typeKey}-${item.id}`} id={`${item.typeKey}-${item.id}`} className="moboko-card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                    {item.type}
                  </span>
                  <span className="text-xs text-[var(--muted)]">{dateLabel(item.publishedAt)}</span>
                </div>
                <h2 className="font-display mt-3 text-xl font-semibold text-[var(--foreground)]">
                  {item.title}
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">
                  {item.body}
                </p>
                {item.author ? <p className="mt-3 text-xs text-[var(--accent)]">{item.author}</p> : null}
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
