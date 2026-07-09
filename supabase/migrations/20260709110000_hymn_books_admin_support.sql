create table if not exists public.hymn_books (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hymn_books_published_name_idx
  on public.hymn_books (is_published, name);

alter table public.hymns
  add column if not exists book_id uuid references public.hymn_books(id) on delete set null,
  add column if not exists verses jsonb not null default '[]'::jsonb,
  add column if not exists chorus text;

create index if not exists hymns_book_number_idx
  on public.hymns (book_id, number);

drop trigger if exists hymn_books_updated_at on public.hymn_books;
create trigger hymn_books_updated_at
  before update on public.hymn_books
  for each row execute function public.set_updated_at();

alter table public.hymn_books enable row level security;

drop policy if exists "hymn_books_select_published_or_admin" on public.hymn_books;
create policy "hymn_books_select_published_or_admin"
  on public.hymn_books for select
  using (is_published = true or public.is_admin(auth.uid()));

drop policy if exists "hymn_books_admin_all" on public.hymn_books;
create policy "hymn_books_admin_all"
  on public.hymn_books for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

insert into public.app_settings (key, value) values
  ('support_suggested_amounts', to_jsonb('5,10,25,50'::text)),
  ('support_team_contact', to_jsonb(''::text))
on conflict (key) do nothing;

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
    'image_credit_cost',
    'initial_free_credits',
    'sermon_ai_search_enabled',
    'sermon_ai_search_credit_cost',
    'free_normal_searches_per_month',
    'subscription_monthly_ai_credits',
    'support_suggested_amounts',
    'support_team_contact'
  );
$$;

drop policy if exists "prayer_requests_select_public_reviewed_or_admin" on public.prayer_requests;
create policy "prayer_requests_select_public_reviewed_or_admin"
  on public.prayer_requests for select
  using ((status = 'reviewed' and is_public = true) or public.is_admin(auth.uid()));
