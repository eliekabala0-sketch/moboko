-- =============================================================================
-- Moboko — schéma Supabase initial (Postgres)
--
-- Buckets Storage créés par ce script :
--   • branding        — image d’accueil (public), upload admin
--   • chat-images     — pièces jointes chat (privé, dossier = user id)
--   • chat-audio      — messages vocaux (privé, dossier = user id)
--   • post-covers     — visuels publications (public), upload admin
--   • post-images     — images inline / médias articles (public), upload admin
--
-- Realtime : projection_sessions, projection_items
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('user', 'admin');
create type public.post_status as enum ('draft', 'published', 'archived');
create type public.message_role as enum ('user', 'assistant', 'system');
create type public.message_kind as enum ('text', 'audio', 'image');
create type public.projection_session_status as enum ('draft', 'live', 'ended');
create type public.projection_item_type as enum (
  'verse',
  'song',
  'announcement',
  'free_text',
  'theme'
);
create type public.subscription_status as enum (
  'incomplete',
  'active',
  'past_due',
  'canceled',
  'paused'
);

-- ---------------------------------------------------------------------------
-- Profils (1:1 auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  role public.user_role not null default 'user',
  credit_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- Paramètres application (une ligne par clé, value = scalaire JSON)
--
-- Clés publiques (lecture anon + authentifié) — gérées par admin :
--   home_hero_image_url   (string | null)
--   home_hero_title       (string)
--   home_hero_subtitle    (string)
--   chat_text_enabled     (bool)
--   chat_voice_enabled    (bool)
--   chat_image_enabled    (bool)
--   text_credit_cost      (number)
--   voice_credit_cost     (number)
--   image_credit_cost     (number)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Conversations & messages (chat IA)
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_id_idx on public.conversations (user_id);
create index conversations_updated_at_idx on public.conversations (updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role public.message_role not null,
  kind public.message_kind not null default 'text',
  content text,
  attachments jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Publications spirituelles
-- ---------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  slug text not null unique,
  excerpt text,
  body text not null,
  cover_storage_path text,
  status public.post_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index posts_status_published_at_idx
  on public.posts (status, published_at desc);

-- ---------------------------------------------------------------------------
-- Projection en direct (session + items ordonnés + statut + Realtime)
-- ---------------------------------------------------------------------------
create table public.projection_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  join_code text not null unique,
  status public.projection_session_status not null default 'draft',
  current_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projection_sessions_host_id_idx on public.projection_sessions (host_id);
create index projection_sessions_status_idx on public.projection_sessions (status);

create table public.projection_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.projection_sessions (id) on delete cascade,
  type public.projection_item_type not null,
  payload jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projection_items_session_sort_idx
  on public.projection_items (session_id, sort_order);

alter table public.projection_sessions
  add constraint projection_sessions_current_item_fk
  foreign key (current_item_id) references public.projection_items (id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- Abonnements & crédits
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_key text not null,
  status public.subscription_status not null default 'incomplete',
  provider text,
  external_id text,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);

create table public.credit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null,
  balance_after integer not null,
  reason text not null,
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index credit_logs_user_id_created_at_idx
  on public.credit_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create trigger posts_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

create trigger projection_sessions_updated_at
  before update on public.projection_sessions
  for each row execute function public.set_updated_at();

create trigger projection_items_updated_at
  before update on public.projection_items
  for each row execute function public.set_updated_at();

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profil synchronisé à l’inscription (même règles web / mobile)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers RLS
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin'
  );
$$;

create or replace function public.app_setting_is_public_readable(k text)
returns boolean
language sql
immutable
as $$
  select k in (
    'home_hero_image_url',
    'home_hero_title',
    'home_hero_subtitle',
    'chat_text_enabled',
    'chat_voice_enabled',
    'chat_image_enabled',
    'text_credit_cost',
    'voice_credit_cost',
    'image_credit_cost'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.posts enable row level security;
alter table public.projection_sessions enable row level security;
alter table public.projection_items enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_logs enable row level security;

-- profiles
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin(auth.uid()));

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_admin_update"
  on public.profiles for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- app_settings
create policy "app_settings_public_read"
  on public.app_settings for select
  using (public.app_setting_is_public_readable(key));

create policy "app_settings_admin_all"
  on public.app_settings for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- conversations
create policy "conversations_select_own"
  on public.conversations for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

create policy "conversations_insert_own"
  on public.conversations for insert
  with check (user_id = auth.uid());

create policy "conversations_update_own"
  on public.conversations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "conversations_delete_own"
  on public.conversations for delete
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- messages
create policy "messages_select_via_conversation"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

create policy "messages_insert_via_conversation"
  on public.messages for insert
  with check (
    role = 'user'
    and kind in ('text', 'audio', 'image')
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "messages_delete_via_conversation"
  on public.messages for delete
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

-- posts
create policy "posts_select_published_or_admin"
  on public.posts for select
  using (
    status = 'published'
    or author_id = auth.uid()
    or public.is_admin(auth.uid())
  );

create policy "posts_admin_write"
  on public.posts for insert
  with check (public.is_admin(auth.uid()));

create policy "posts_admin_update"
  on public.posts for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "posts_admin_delete"
  on public.posts for delete
  using (public.is_admin(auth.uid()));

-- projection_sessions
create policy "projection_sessions_select_host_or_live"
  on public.projection_sessions for select
  using (
    host_id = auth.uid()
    or public.is_admin(auth.uid())
    or status = 'live'
  );

create policy "projection_sessions_insert_admin"
  on public.projection_sessions for insert
  with check (
    public.is_admin(auth.uid())
    and host_id = auth.uid()
  );

create policy "projection_sessions_update_host_admin"
  on public.projection_sessions for update
  using (host_id = auth.uid() or public.is_admin(auth.uid()))
  with check (host_id = auth.uid() or public.is_admin(auth.uid()));

create policy "projection_sessions_delete_host_admin"
  on public.projection_sessions for delete
  using (host_id = auth.uid() or public.is_admin(auth.uid()));

-- projection_items
create policy "projection_items_select_via_session"
  on public.projection_items for select
  using (
    exists (
      select 1 from public.projection_sessions s
      where s.id = projection_items.session_id
        and (
          s.host_id = auth.uid()
          or public.is_admin(auth.uid())
          or s.status = 'live'
        )
    )
  );

create policy "projection_items_write_host_admin"
  on public.projection_items for insert
  with check (
    exists (
      select 1 from public.projection_sessions s
      where s.id = projection_items.session_id
        and (s.host_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

create policy "projection_items_update_host_admin"
  on public.projection_items for update
  using (
    exists (
      select 1 from public.projection_sessions s
      where s.id = projection_items.session_id
        and (s.host_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

create policy "projection_items_delete_host_admin"
  on public.projection_items for delete
  using (
    exists (
      select 1 from public.projection_sessions s
      where s.id = projection_items.session_id
        and (s.host_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

-- subscriptions
create policy "subscriptions_select_own_admin"
  on public.subscriptions for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

create policy "subscriptions_admin_write"
  on public.subscriptions for insert
  with check (public.is_admin(auth.uid()));

create policy "subscriptions_admin_update"
  on public.subscriptions for update
  using (public.is_admin(auth.uid()));

-- credit_logs (écriture consommation IA : service role ou fonction défensive — pas le client anon)
create policy "credit_logs_select_own_admin"
  on public.credit_logs for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

create policy "credit_logs_admin_insert"
  on public.credit_logs for insert
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime (affichage audience synchronisé)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.projection_sessions;
alter publication supabase_realtime add table public.projection_items;

-- ---------------------------------------------------------------------------
-- Storage : buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('branding', 'branding', true),
  ('chat-audio', 'chat-audio', false),
  ('chat-images', 'chat-images', false),
  ('post-covers', 'post-covers', true),
  ('post-images', 'post-images', true)
on conflict (id) do nothing;

-- Branding
create policy "branding_public_read"
  on storage.objects for select
  using (bucket_id = 'branding');

create policy "branding_admin_write"
  on storage.objects for insert
  with check (bucket_id = 'branding' and public.is_admin(auth.uid()));

create policy "branding_admin_update"
  on storage.objects for update
  using (bucket_id = 'branding' and public.is_admin(auth.uid()));

create policy "branding_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'branding' and public.is_admin(auth.uid()));

-- Chat audio (chemin : {user_id}/...)
create policy "chat_audio_own_select"
  on storage.objects for select
  using (
    bucket_id = 'chat-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "chat_audio_own_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "chat_audio_own_update"
  on storage.objects for update
  using (
    bucket_id = 'chat-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "chat_audio_own_delete"
  on storage.objects for delete
  using (
    bucket_id = 'chat-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Chat images
create policy "chat_images_own_select"
  on storage.objects for select
  using (
    bucket_id = 'chat-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "chat_images_own_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "chat_images_own_update"
  on storage.objects for update
  using (
    bucket_id = 'chat-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "chat_images_own_delete"
  on storage.objects for delete
  using (
    bucket_id = 'chat-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Post covers
create policy "post_covers_public_read"
  on storage.objects for select
  using (bucket_id = 'post-covers');

create policy "post_covers_admin_write"
  on storage.objects for insert
  with check (bucket_id = 'post-covers' and public.is_admin(auth.uid()));

create policy "post_covers_admin_mutate"
  on storage.objects for update
  using (bucket_id = 'post-covers' and public.is_admin(auth.uid()));

create policy "post_covers_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'post-covers' and public.is_admin(auth.uid()));

-- Post images (même modèle que les covers)
create policy "post_images_public_read"
  on storage.objects for select
  using (bucket_id = 'post-images');

create policy "post_images_admin_write"
  on storage.objects for insert
  with check (bucket_id = 'post-images' and public.is_admin(auth.uid()));

create policy "post_images_admin_update"
  on storage.objects for update
  using (bucket_id = 'post-images' and public.is_admin(auth.uid()));

create policy "post_images_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'post-images' and public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Valeurs par défaut des paramètres publics (admin les ajustera / URLs Storage)
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('home_hero_image_url', 'null'::jsonb),
  ('home_hero_title', to_jsonb(''::text)),
  ('home_hero_subtitle', to_jsonb(''::text)),
  ('chat_text_enabled', to_jsonb(true)),
  ('chat_voice_enabled', to_jsonb(true)),
  ('chat_image_enabled', to_jsonb(true)),
  ('text_credit_cost', to_jsonb(1)),
  ('voice_credit_cost', to_jsonb(2)),
  ('image_credit_cost', to_jsonb(3))
on conflict (key) do nothing;
