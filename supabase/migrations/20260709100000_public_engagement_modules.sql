create table if not exists public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text,
  email text,
  request_text text not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'archived')),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testimonies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text,
  title text not null,
  testimony_text text not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text,
  email text,
  subject text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'reviewed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prayer_requests_status_created_at_idx
  on public.prayer_requests (status, created_at desc);
create index if not exists testimonies_status_created_at_idx
  on public.testimonies (status, created_at desc);
create index if not exists support_messages_status_created_at_idx
  on public.support_messages (status, created_at desc);

drop trigger if exists prayer_requests_updated_at on public.prayer_requests;
create trigger prayer_requests_updated_at
  before update on public.prayer_requests
  for each row execute function public.set_updated_at();

drop trigger if exists testimonies_updated_at on public.testimonies;
create trigger testimonies_updated_at
  before update on public.testimonies
  for each row execute function public.set_updated_at();

drop trigger if exists support_messages_updated_at on public.support_messages;
create trigger support_messages_updated_at
  before update on public.support_messages
  for each row execute function public.set_updated_at();

alter table public.prayer_requests enable row level security;
alter table public.testimonies enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "prayer_requests_insert_public" on public.prayer_requests;
create policy "prayer_requests_insert_public"
  on public.prayer_requests for insert
  with check (true);

drop policy if exists "prayer_requests_admin_all" on public.prayer_requests;
create policy "prayer_requests_admin_all"
  on public.prayer_requests for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "testimonies_insert_public" on public.testimonies;
create policy "testimonies_insert_public"
  on public.testimonies for insert
  with check (true);

drop policy if exists "testimonies_select_published_or_admin" on public.testimonies;
create policy "testimonies_select_published_or_admin"
  on public.testimonies for select
  using (status = 'published' or public.is_admin(auth.uid()));

drop policy if exists "testimonies_admin_all" on public.testimonies;
create policy "testimonies_admin_all"
  on public.testimonies for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "support_messages_insert_public" on public.support_messages;
create policy "support_messages_insert_public"
  on public.support_messages for insert
  with check (true);

drop policy if exists "support_messages_admin_all" on public.support_messages;
create policy "support_messages_admin_all"
  on public.support_messages for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
