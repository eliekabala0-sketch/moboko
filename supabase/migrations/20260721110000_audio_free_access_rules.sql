alter table public.audio_items
  add column if not exists access_policy text not null default 'subscription'
    check (access_policy in ('free', 'subscription', 'excerpt', 'unavailable')),
  add column if not exists free_excerpt_seconds integer not null default 0
    check (free_excerpt_seconds >= 0),
  add column if not exists free_monthly_play_limit integer null
    check (free_monthly_play_limit is null or free_monthly_play_limit >= 0);

create table if not exists public.audio_access_settings (
  id boolean primary key default true check (id),
  free_streaming_enabled boolean not null default false,
  free_streaming_monthly_limit integer null check (free_streaming_monthly_limit is null or free_streaming_monthly_limit >= 0),
  free_offline_in_app boolean not null default false,
  free_full_download boolean not null default false,
  free_audio_search boolean not null default false,
  free_excerpt_seconds integer not null default 0 check (free_excerpt_seconds >= 0),
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.audio_access_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.audio_play_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  audio_id uuid not null references public.audio_items(id) on delete cascade,
  event_type text not null default 'stream' check (event_type in ('stream', 'offline', 'download')),
  access_source text not null default 'subscription' check (access_source in ('free', 'subscription', 'admin', 'override')),
  created_at timestamptz not null default now()
);

create index if not exists audio_items_access_policy_idx
  on public.audio_items(access_policy);

create index if not exists audio_play_events_user_month_idx
  on public.audio_play_events(user_id, created_at desc);

alter table public.audio_access_settings enable row level security;
alter table public.audio_play_events enable row level security;

drop policy if exists "audio access settings admin read" on public.audio_access_settings;
create policy "audio access settings admin read"
  on public.audio_access_settings
  for select
  using (public.is_admin(auth.uid()));

drop policy if exists "audio access settings admin write" on public.audio_access_settings;
create policy "audio access settings admin write"
  on public.audio_access_settings
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "audio play events owner read" on public.audio_play_events;
create policy "audio play events owner read"
  on public.audio_play_events
  for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "audio play events service/admin write" on public.audio_play_events;
create policy "audio play events service/admin write"
  on public.audio_play_events
  for insert
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));
