create extension if not exists pg_trgm with schema public;

alter table public.billing_subscription_plans
  add column if not exists audio_streaming boolean not null default false,
  add column if not exists audio_offline_in_app boolean not null default false,
  add column if not exists audio_full_download boolean not null default false,
  add column if not exists audio_search boolean not null default false;

create table if not exists public.audio_items (
  id uuid primary key default gen_random_uuid(),
  media_type text not null default 'audio' check (media_type in ('audio', 'video')),
  category text not null check (category in ('sermon', 'prayer_line')),
  title text not null,
  normalized_title text not null,
  original_filename text not null,
  original_relative_path text,
  storage_bucket text not null default 'sermon-audio',
  storage_path text not null unique,
  mime_type text,
  file_size bigint not null check (file_size >= 0),
  duration_seconds integer,
  bitrate integer,
  codec text,
  checksum_sha256 text,
  sermon_id uuid references public.sermons(id) on delete set null,
  sermon_match_status text not null default 'unmatched'
    check (sermon_match_status in ('matched', 'probable_match', 'unmatched', 'manual_review')),
  sermon_match_score numeric(5,4),
  sermon_date date,
  sermon_year integer,
  location text,
  language text not null default 'fr',
  is_active boolean not null default false,
  streaming_enabled boolean not null default true,
  offline_enabled boolean not null default false,
  full_download_enabled boolean not null default false,
  import_status text not null default 'pending'
    check (import_status in ('pending', 'inventoried', 'uploaded', 'verified', 'failed', 'skipped', 'manual_review')),
  import_error text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.audio_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_root text not null,
  category text not null check (category in ('sermon', 'prayer_line')),
  dry_run boolean not null default true,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  total_files integer not null default 0,
  processed_files integer not null default 0,
  uploaded_files integer not null default 0,
  skipped_files integer not null default 0,
  failed_files integer not null default 0,
  total_bytes bigint not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  notes text
);

create table if not exists public.audio_import_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.audio_import_runs(id) on delete cascade,
  audio_id uuid references public.audio_items(id) on delete set null,
  level text not null default 'info' check (level in ('info', 'warning', 'error')),
  event_type text not null,
  message text,
  source_path text,
  storage_path text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audio_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  audio_id uuid not null references public.audio_items(id) on delete cascade,
  position_seconds integer not null default 0 check (position_seconds >= 0),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, audio_id)
);

create table if not exists public.audio_offline_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audio_id uuid not null references public.audio_items(id) on delete cascade,
  download_type text not null check (download_type in ('offline_in_app', 'full_download')),
  device_id text,
  file_size bigint,
  downloaded_at timestamptz not null default now(),
  last_verified_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, audio_id, download_type, device_id)
);

create table if not exists public.user_audio_access_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audio_streaming boolean,
  audio_offline_in_app boolean,
  audio_full_download boolean,
  audio_search boolean,
  expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (user_id)
);

create table if not exists public.audio_transcripts (
  id uuid primary key default gen_random_uuid(),
  audio_id uuid not null references public.audio_items(id) on delete cascade,
  language text not null default 'fr',
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'manual_review')),
  full_text text,
  confidence numeric(5,4),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audio_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.audio_transcripts(id) on delete cascade,
  audio_id uuid not null references public.audio_items(id) on delete cascade,
  start_seconds numeric(10,3) not null check (start_seconds >= 0),
  end_seconds numeric(10,3) not null check (end_seconds >= start_seconds),
  text text not null,
  official_paragraph_id uuid references public.sermon_paragraphs(id) on delete set null,
  confidence numeric(5,4),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected', 'manual_review')),
  created_at timestamptz not null default now()
);

create index if not exists audio_items_category_active_idx
  on public.audio_items (category, is_active, sermon_year desc, title);
create index if not exists audio_items_sermon_id_idx
  on public.audio_items (sermon_id) where sermon_id is not null;
create index if not exists audio_items_checksum_idx
  on public.audio_items (checksum_sha256) where checksum_sha256 is not null;
create index if not exists audio_items_normalized_title_trgm_idx
  on public.audio_items using gin (normalized_title extensions.gin_trgm_ops);
create index if not exists audio_items_import_status_idx
  on public.audio_items (import_status, category, updated_at desc);
create index if not exists audio_import_events_run_idx
  on public.audio_import_events (run_id, created_at desc);
create index if not exists audio_transcript_segments_audio_start_idx
  on public.audio_transcript_segments (audio_id, start_seconds);
create index if not exists audio_transcript_segments_text_trgm_idx
  on public.audio_transcript_segments using gin (text extensions.gin_trgm_ops);

drop trigger if exists audio_items_updated_at on public.audio_items;
create trigger audio_items_updated_at
  before update on public.audio_items
  for each row execute function public.set_updated_at();

drop trigger if exists user_audio_access_overrides_updated_at on public.user_audio_access_overrides;
create trigger user_audio_access_overrides_updated_at
  before update on public.user_audio_access_overrides
  for each row execute function public.set_updated_at();

drop trigger if exists audio_transcripts_updated_at on public.audio_transcripts;
create trigger audio_transcripts_updated_at
  before update on public.audio_transcripts
  for each row execute function public.set_updated_at();

alter table public.audio_items enable row level security;
alter table public.audio_import_runs enable row level security;
alter table public.audio_import_events enable row level security;
alter table public.audio_progress enable row level security;
alter table public.audio_offline_records enable row level security;
alter table public.user_audio_access_overrides enable row level security;
alter table public.audio_transcripts enable row level security;
alter table public.audio_transcript_segments enable row level security;

drop policy if exists "audio_items_admin_all" on public.audio_items;
create policy "audio_items_admin_all" on public.audio_items for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "audio_import_runs_admin_all" on public.audio_import_runs;
create policy "audio_import_runs_admin_all" on public.audio_import_runs for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "audio_import_events_admin_all" on public.audio_import_events;
create policy "audio_import_events_admin_all" on public.audio_import_events for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "audio_progress_owner_all" on public.audio_progress;
create policy "audio_progress_owner_all" on public.audio_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "audio_progress_admin_all" on public.audio_progress;
create policy "audio_progress_admin_all" on public.audio_progress for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "audio_offline_records_owner_select" on public.audio_offline_records;
create policy "audio_offline_records_owner_select" on public.audio_offline_records for select
  using (user_id = auth.uid());

drop policy if exists "audio_offline_records_admin_all" on public.audio_offline_records;
create policy "audio_offline_records_admin_all" on public.audio_offline_records for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "user_audio_access_overrides_owner_select" on public.user_audio_access_overrides;
create policy "user_audio_access_overrides_owner_select" on public.user_audio_access_overrides for select
  using (user_id = auth.uid());

drop policy if exists "user_audio_access_overrides_admin_all" on public.user_audio_access_overrides;
create policy "user_audio_access_overrides_admin_all" on public.user_audio_access_overrides for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "audio_transcripts_admin_all" on public.audio_transcripts;
create policy "audio_transcripts_admin_all" on public.audio_transcripts for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "audio_transcript_segments_admin_all" on public.audio_transcript_segments;
create policy "audio_transcript_segments_admin_all" on public.audio_transcript_segments for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "sermon_audio_storage_admin_all" on storage.objects;
create policy "sermon_audio_storage_admin_all" on storage.objects for all
  using (bucket_id = 'sermon-audio' and public.is_admin(auth.uid()))
  with check (bucket_id = 'sermon-audio' and public.is_admin(auth.uid()));

comment on table public.audio_items is 'Metadonnees des medias audio Moboko. Les fichiers restent en Storage prive.';
comment on column public.audio_items.category is 'sermon: audio de sermon; prayer_line: ligne de priere separee de la recherche doctrinale.';
comment on column public.audio_items.media_type is 'Prepare l evolution future vers la video.';
comment on column public.audio_items.storage_path is 'Chemin objet dans le bucket prive. Jamais expose comme URL permanente.';
