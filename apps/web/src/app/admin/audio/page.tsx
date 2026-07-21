import { requireAdmin } from "@/lib/admin/require-admin";
import { saveAudioAccessSettingsAction, saveAudioItemAction, saveAudioOverrideAction } from "./actions";

export const metadata = { title: "Audio | Admin Moboko" };

type SearchParams = Promise<{ q?: string; category?: string; status?: string }>;

type AdminAudioRow = {
  id: string;
  category: string | null;
  title: string | null;
  original_filename: string | null;
  file_size: number | null;
  sermon_year: number | null;
  location: string | null;
  sermon_id: string | null;
  sermon_match_status: string | null;
  import_status: string | null;
  is_active: boolean | null;
  streaming_enabled: boolean | null;
  offline_enabled: boolean | null;
  full_download_enabled: boolean | null;
  access_policy?: string | null;
  free_excerpt_seconds?: number | null;
  free_monthly_play_limit?: number | null;
  sermons?: unknown;
};

function sizeLabel(bytes: number | null) {
  if (!bytes) return "—";
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AdminAudioPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const category = sp.category === "sermon" || sp.category === "prayer_line" ? sp.category : "";
  const status = sp.status?.trim() ?? "";

  const [{ data: statsRows }, { data: importRuns }, { data: events }, { data: overrides }, settingsResult] = await Promise.all([
    supabase.from("audio_items").select("category, is_active, import_status, file_size"),
    supabase.from("audio_import_runs").select("id, category, status, total_files, uploaded_files, failed_files, started_at, finished_at").order("started_at", { ascending: false }).limit(10),
    supabase.from("audio_import_events").select("id, level, event_type, message, source_path, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("user_audio_access_overrides").select("id, user_id, audio_streaming, audio_offline_in_app, audio_full_download, audio_search, expires_at, notes").order("updated_at", { ascending: false }).limit(20),
    supabase.from("audio_access_settings").select("*").eq("id", true).maybeSingle(),
  ]);
  const audioSettings = settingsResult.error ? null : settingsResult.data;

  let audioQuery = supabase
    .from("audio_items")
    .select("id, category, title, original_filename, file_size, sermon_year, location, sermon_id, sermon_match_status, import_status, is_active, streaming_enabled, offline_enabled, full_download_enabled, access_policy, free_excerpt_seconds, free_monthly_play_limit, sermons(id, title)")
    .order("updated_at", { ascending: false })
    .limit(60);
  if (category) audioQuery = audioQuery.eq("category", category);
  if (status) audioQuery = audioQuery.eq("sermon_match_status", status);
  if (q) audioQuery = audioQuery.ilike("normalized_title", `%${q.toLowerCase().replace(/[^a-z0-9]+/g, "%")}%`);
  const audioResult = (await audioQuery) as { data: AdminAudioRow[] | null; error: { code?: string; message?: string } | null };
  let audios = audioResult.data;
  const audioError = audioResult.error;
  if (audioError) {
    let fallbackQuery = supabase
      .from("audio_items")
      .select("id, category, title, original_filename, file_size, sermon_year, location, sermon_id, sermon_match_status, import_status, is_active, streaming_enabled, offline_enabled, full_download_enabled, sermons(id, title)")
      .order("updated_at", { ascending: false })
      .limit(60);
    if (category) fallbackQuery = fallbackQuery.eq("category", category);
    if (status) fallbackQuery = fallbackQuery.eq("sermon_match_status", status);
    if (q) fallbackQuery = fallbackQuery.ilike("normalized_title", `%${q.toLowerCase().replace(/[^a-z0-9]+/g, "%")}%`);
    const fallback = await fallbackQuery;
    audios = fallback.data;
  }

  const total = statsRows?.length ?? 0;
  const active = statsRows?.filter((row) => row.is_active).length ?? 0;
  const bytes = statsRows?.reduce((sum, row) => sum + (Number(row.file_size) || 0), 0) ?? 0;
  const sermonCount = statsRows?.filter((row) => row.category === "sermon").length ?? 0;
  const prayerCount = statsRows?.filter((row) => row.category === "prayer_line").length ?? 0;

  return (
    <main>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
      <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">Mediatheque audio</h1>

      <section className="mt-8 grid gap-3 sm:grid-cols-4">
        {[["Audios", total], ["Actifs", active], ["Sermons", sermonCount], ["Lignes de priere", prayerCount]].map(([label, value]) => (
          <div key={label} className="moboko-card p-4">
            <p className="text-xs text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</p>
          </div>
        ))}
      </section>
      <p className="mt-3 text-sm text-[var(--muted)]">Taille referencee: {sizeLabel(bytes)}. Les fichiers originaux restent sur D: et ne sont jamais modifies.</p>

      {audioSettings ? (
        <form action={saveAudioAccessSettingsAction} className="moboko-card mt-8 grid gap-3 p-4 text-sm md:grid-cols-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)] md:col-span-4">Mode gratuit audio</h2>
          <label className="flex items-center gap-2 text-[var(--muted)]">
            <input name="free_streaming_enabled" type="checkbox" defaultChecked={Boolean(audioSettings.free_streaming_enabled)} />
            Streaming gratuit
          </label>
          <label className="flex items-center gap-2 text-[var(--muted)]">
            <input name="free_offline_in_app" type="checkbox" defaultChecked={Boolean(audioSettings.free_offline_in_app)} />
            Hors connexion gratuit
          </label>
          <label className="flex items-center gap-2 text-[var(--muted)]">
            <input name="free_full_download" type="checkbox" defaultChecked={Boolean(audioSettings.free_full_download)} />
            Telechargement gratuit
          </label>
          <label className="flex items-center gap-2 text-[var(--muted)]">
            <input name="free_audio_search" type="checkbox" defaultChecked={Boolean(audioSettings.free_audio_search)} />
            Recherche audio gratuite
          </label>
          <label>
            <span className="text-xs text-[var(--muted)]">Ecoutes gratuites / mois</span>
            <input name="free_streaming_monthly_limit" className="moboko-input mt-1" type="number" min={0} defaultValue={audioSettings.free_streaming_monthly_limit ?? ""} />
          </label>
          <label>
            <span className="text-xs text-[var(--muted)]">Duree extrait par defaut (secondes)</span>
            <input name="free_excerpt_seconds" className="moboko-input mt-1" type="number" min={0} defaultValue={audioSettings.free_excerpt_seconds ?? 0} />
          </label>
          <button className="moboko-btn-primary px-4 py-2 md:col-span-4" type="submit">Enregistrer le mode gratuit</button>
        </form>
      ) : null}

      <form className="moboko-card mt-8 grid gap-3 p-4 md:grid-cols-4">
        <input name="q" className="moboko-input" placeholder="Rechercher" defaultValue={q} />
        <select name="category" className="moboko-input" defaultValue={category}>
          <option value="">Toutes categories</option>
          <option value="sermon">Sermons</option>
          <option value="prayer_line">Lignes de priere</option>
        </select>
        <select name="status" className="moboko-input" defaultValue={status}>
          <option value="">Tous liens sermon</option>
          <option value="matched">Confirmes</option>
          <option value="probable_match">Probables</option>
          <option value="unmatched">Sans lien</option>
          <option value="manual_review">A verifier</option>
        </select>
        <button className="moboko-btn-primary px-4 py-2" type="submit">Filtrer</button>
      </form>

      <section className="mt-8 space-y-4">
        {(audios ?? []).map((audio) => (
          <form key={audio.id} action={saveAudioItemAction} className="moboko-card grid gap-3 p-4 text-sm md:grid-cols-4">
            <input type="hidden" name="id" value={audio.id} />
            <label className="md:col-span-2">
              <span className="text-xs text-[var(--muted)]">Titre</span>
              <input name="title" className="moboko-input mt-1" defaultValue={audio.title ?? ""} />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Annee</span>
              <input name="sermon_year" className="moboko-input mt-1" type="number" defaultValue={audio.sermon_year ?? ""} />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Lieu</span>
              <input name="location" className="moboko-input mt-1" defaultValue={audio.location ?? ""} />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Sermon ID</span>
              <input name="sermon_id" className="moboko-input mt-1" defaultValue={audio.sermon_id ?? ""} />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Correspondance</span>
              <select name="sermon_match_status" className="moboko-input mt-1" defaultValue={audio.sermon_match_status ?? "manual_review"}>
                <option value="matched">matched</option>
                <option value="probable_match">probable_match</option>
                <option value="unmatched">unmatched</option>
                <option value="manual_review">manual_review</option>
              </select>
            </label>
            <p className="text-xs text-[var(--muted)] md:col-span-2">
              {audio.category} - {audio.original_filename} - {sizeLabel(audio.file_size)}
            </p>
            <div className="flex flex-wrap gap-3 md:col-span-4">
              <label className="flex items-center gap-2 text-[var(--muted)]"><input name="is_active" type="checkbox" defaultChecked={Boolean(audio.is_active)} /> Actif</label>
              <label className="flex items-center gap-2 text-[var(--muted)]"><input name="streaming_enabled" type="checkbox" defaultChecked={Boolean(audio.streaming_enabled)} /> Streaming</label>
              <label className="flex items-center gap-2 text-[var(--muted)]"><input name="offline_enabled" type="checkbox" defaultChecked={Boolean(audio.offline_enabled)} /> Hors connexion</label>
              <label className="flex items-center gap-2 text-[var(--muted)]"><input name="full_download_enabled" type="checkbox" defaultChecked={Boolean(audio.full_download_enabled)} /> Fichier complet</label>
            </div>
            {"access_policy" in audio ? (
              <div className="grid gap-3 md:col-span-4 md:grid-cols-3">
                <label>
                  <span className="text-xs text-[var(--muted)]">Acces</span>
                  <select name="access_policy" className="moboko-input mt-1" defaultValue={String(audio.access_policy ?? "subscription")}>
                    <option value="free">Gratuit</option>
                    <option value="subscription">Reserve abonnement</option>
                    <option value="excerpt">Extrait gratuit</option>
                    <option value="unavailable">Non disponible</option>
                  </select>
                </label>
                <label>
                  <span className="text-xs text-[var(--muted)]">Extrait gratuit (secondes)</span>
                  <input name="free_excerpt_seconds" className="moboko-input mt-1" type="number" min={0} defaultValue={audio.free_excerpt_seconds ?? 0} />
                </label>
                <label>
                  <span className="text-xs text-[var(--muted)]">Limite ecoutes / mois</span>
                  <input name="free_monthly_play_limit" className="moboko-input mt-1" type="number" min={0} defaultValue={audio.free_monthly_play_limit ?? ""} />
                </label>
              </div>
            ) : null}
            <button className="moboko-btn-primary px-4 py-2 md:col-span-4" type="submit">Enregistrer</button>
          </form>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Acces audio manuel</h2>
        <form action={saveAudioOverrideAction} className="moboko-card mt-4 grid gap-3 p-4 text-sm md:grid-cols-4">
          <input name="user_id" className="moboko-input" placeholder="User ID" required />
          <input name="expires_at" className="moboko-input" placeholder="Expiration ISO optionnelle" />
          <input name="notes" className="moboko-input md:col-span-2" placeholder="Note admin" />
          <label className="flex items-center gap-2 text-[var(--muted)]"><input name="audio_streaming" type="checkbox" /> Streaming</label>
          <label className="flex items-center gap-2 text-[var(--muted)]"><input name="audio_offline_in_app" type="checkbox" /> Hors connexion</label>
          <label className="flex items-center gap-2 text-[var(--muted)]"><input name="audio_full_download" type="checkbox" /> Telechargement</label>
          <label className="flex items-center gap-2 text-[var(--muted)]"><input name="audio_search" type="checkbox" /> Recherche audio</label>
          <button className="moboko-btn-primary px-4 py-2 md:col-span-4" type="submit">Attribuer</button>
        </form>
        <div className="mt-4 space-y-2 text-xs text-[var(--muted)]">
          {(overrides ?? []).map((row) => (
            <p key={row.id} className="moboko-card p-3">{row.user_id} - streaming:{String(row.audio_streaming)} offline:{String(row.audio_offline_in_app)} download:{String(row.audio_full_download)} search:{String(row.audio_search)}</p>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Imports recents</h2>
          <div className="mt-4 space-y-2 text-sm text-[var(--muted)]">
            {(importRuns ?? []).map((run) => (
              <p key={run.id} className="moboko-card p-3">{run.category} - {run.status} - {run.uploaded_files}/{run.total_files}</p>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Erreurs et evenements</h2>
          <div className="mt-4 space-y-2 text-sm text-[var(--muted)]">
            {(events ?? []).map((event) => (
              <p key={event.id} className="moboko-card p-3">{event.level} - {event.event_type} - {event.message ?? event.source_path}</p>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
