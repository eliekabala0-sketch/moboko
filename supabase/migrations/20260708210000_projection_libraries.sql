-- Projection libraries: keep Message, Bible, and hymns separate.

create table if not exists public.hymns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  number text,
  category text,
  lyrics text not null,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hymns_published_title_idx
  on public.hymns (is_published, title);

create index if not exists hymns_number_idx
  on public.hymns (number);

create table if not exists public.bible_passages (
  id uuid primary key default gen_random_uuid(),
  translation text not null default 'LSG',
  book text not null,
  chapter integer not null,
  verse integer not null,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bible_passages_ref_unique unique (translation, book, chapter, verse),
  constraint bible_passages_chapter_positive check (chapter > 0),
  constraint bible_passages_verse_positive check (verse > 0)
);

create index if not exists bible_passages_lookup_idx
  on public.bible_passages (translation, book, chapter, verse);

drop trigger if exists hymns_updated_at on public.hymns;
create trigger hymns_updated_at
  before update on public.hymns
  for each row execute function public.set_updated_at();

drop trigger if exists bible_passages_updated_at on public.bible_passages;
create trigger bible_passages_updated_at
  before update on public.bible_passages
  for each row execute function public.set_updated_at();

alter table public.hymns enable row level security;
alter table public.bible_passages enable row level security;

drop policy if exists "hymns_select_published_or_admin" on public.hymns;
create policy "hymns_select_published_or_admin"
  on public.hymns for select
  using (is_published = true or public.is_admin(auth.uid()));

drop policy if exists "hymns_admin_all" on public.hymns;
create policy "hymns_admin_all"
  on public.hymns for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "bible_passages_select_all" on public.bible_passages;
create policy "bible_passages_select_all"
  on public.bible_passages for select
  using (true);

drop policy if exists "bible_passages_admin_all" on public.bible_passages;
create policy "bible_passages_admin_all"
  on public.bible_passages for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
