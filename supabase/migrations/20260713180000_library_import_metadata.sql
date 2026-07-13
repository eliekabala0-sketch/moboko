alter table public.hymn_books
  add column if not exists language text,
  add column if not exists source_file_path text,
  add column if not exists source_file_name text,
  add column if not exists source_file_size bigint,
  add column if not exists source_file_hash text,
  add column if not exists total_hymns integer not null default 0,
  add column if not exists import_status text not null default 'pending',
  add column if not exists import_report jsonb not null default '{}'::jsonb,
  add column if not exists imported_at timestamptz;

alter table public.hymns
  add column if not exists key_signature text,
  add column if not exists full_text text,
  add column if not exists search_text text,
  add column if not exists validation_status text not null default 'valid',
  add column if not exists validation_notes jsonb not null default '[]'::jsonb,
  add column if not exists display_order integer;

update public.hymns
set full_text = coalesce(full_text, lyrics),
    search_text = coalesce(search_text, title || ' ' || coalesce(number, '') || ' ' || lyrics)
where full_text is null or search_text is null;

create unique index if not exists hymns_book_number_unique
  on public.hymns (book_id, number)
  where book_id is not null and number is not null;

create index if not exists hymns_search_text_idx
  on public.hymns using gin (to_tsvector('simple', coalesce(search_text, '')));

create index if not exists hymn_books_import_status_idx
  on public.hymn_books (import_status, is_published);

create table if not exists public.bible_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  abbreviation text not null unique,
  language text not null default 'fr',
  testament_scope text not null default 'complete',
  source_file_path text,
  source_file_name text,
  source_file_size bigint,
  source_file_hash text,
  total_books integer not null default 0,
  total_chapters integer not null default 0,
  total_verses integer not null default 0,
  is_published boolean not null default true,
  import_status text not null default 'pending',
  import_report jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bible_passages
  add column if not exists version_id uuid references public.bible_versions(id) on delete cascade,
  add column if not exists book_number integer,
  add column if not exists book_name text,
  add column if not exists search_text text,
  add column if not exists validation_status text not null default 'valid';

update public.bible_passages
set book_name = coalesce(book_name, book),
    search_text = coalesce(search_text, book || ' ' || chapter || ':' || verse || ' ' || text)
where book_name is null or search_text is null;

create unique index if not exists bible_passages_version_ref_unique
  on public.bible_passages (version_id, book_name, chapter, verse)
  where version_id is not null;

create index if not exists bible_passages_version_lookup_idx
  on public.bible_passages (version_id, book_number, chapter, verse);

create index if not exists bible_passages_search_text_idx
  on public.bible_passages using gin (to_tsvector('simple', coalesce(search_text, '')));

drop trigger if exists bible_versions_updated_at on public.bible_versions;
create trigger bible_versions_updated_at
  before update on public.bible_versions
  for each row execute function public.set_updated_at();

alter table public.bible_versions enable row level security;

drop policy if exists "bible_versions_select_published_or_admin" on public.bible_versions;
create policy "bible_versions_select_published_or_admin"
  on public.bible_versions for select
  using (is_published = true or public.is_admin(auth.uid()));

drop policy if exists "bible_versions_admin_all" on public.bible_versions;
create policy "bible_versions_admin_all"
  on public.bible_versions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

insert into storage.buckets (id, name, public)
values ('library-sources', 'library-sources', false)
on conflict (id) do nothing;

drop policy if exists "library_sources_admin_all" on storage.objects;
create policy "library_sources_admin_all"
  on storage.objects for all
  using (bucket_id = 'library-sources' and public.is_admin(auth.uid()))
  with check (bucket_id = 'library-sources' and public.is_admin(auth.uid()));
