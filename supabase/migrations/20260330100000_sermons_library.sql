-- =============================================================================
-- Moboko — bibliothèque de sermons (lecture, navigation, projection / IA futures)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Sermons
-- ---------------------------------------------------------------------------
create table public.sermons (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  preached_on date,
  year smallint,
  location text,
  country text,
  city text,
  series text,
  source_file text not null,
  content_plain text not null default '',
  paragraph_count integer not null default 0,
  language text not null default 'fr',
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sermons_slug_unique unique (slug),
  constraint sermons_source_file_unique unique (source_file)
);

create index sermons_preached_on_idx on public.sermons (preached_on desc nulls last);
create index sermons_year_idx on public.sermons (year);
create index sermons_published_idx on public.sermons (is_published) where is_published = true;
create index sermons_title_search_idx on public.sermons using gin (to_tsvector('french', title));

-- ---------------------------------------------------------------------------
-- Paragraphes
-- ---------------------------------------------------------------------------
create table public.sermon_paragraphs (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons (id) on delete cascade,
  paragraph_number integer not null,
  paragraph_text text not null,
  normalized_text text not null default '',
  search_tsv tsvector generated always as (
    to_tsvector('french', coalesce(normalized_text, ''))
  ) stored,
  created_at timestamptz not null default now(),
  constraint sermon_paragraphs_sermon_num_unique unique (sermon_id, paragraph_number)
);

create index sermon_paragraphs_sermon_id_idx on public.sermon_paragraphs (sermon_id);
create index sermon_paragraphs_search_tsv_idx on public.sermon_paragraphs using gin (search_tsv);

-- ---------------------------------------------------------------------------
-- Alias (titres alternatifs, références)
-- ---------------------------------------------------------------------------
create table public.sermon_aliases (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons (id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  constraint sermon_aliases_sermon_alias_unique unique (sermon_id, alias)
);

create index sermon_aliases_alias_idx on public.sermon_aliases (alias);

-- ---------------------------------------------------------------------------
-- Journal d’import
-- ---------------------------------------------------------------------------
create table public.library_import_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'sermon_clean_txt',
  source_path text not null,
  imported_count integer not null default 0,
  failed_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create trigger sermons_updated_at
  before update on public.sermons
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.sermons enable row level security;
alter table public.sermon_paragraphs enable row level security;
alter table public.sermon_aliases enable row level security;
alter table public.library_import_jobs enable row level security;

create policy "sermons_select_published_or_admin"
  on public.sermons for select
  using (is_published = true or public.is_admin(auth.uid()));

create policy "sermons_admin_write"
  on public.sermons for insert
  with check (public.is_admin(auth.uid()));

create policy "sermons_admin_update"
  on public.sermons for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "sermons_admin_delete"
  on public.sermons for delete
  using (public.is_admin(auth.uid()));

create policy "sermon_paragraphs_select_via_sermon"
  on public.sermon_paragraphs for select
  using (
    exists (
      select 1 from public.sermons s
      where s.id = sermon_paragraphs.sermon_id
        and (s.is_published = true or public.is_admin(auth.uid()))
    )
  );

create policy "sermon_paragraphs_admin_write"
  on public.sermon_paragraphs for insert
  with check (public.is_admin(auth.uid()));

create policy "sermon_paragraphs_admin_update"
  on public.sermon_paragraphs for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "sermon_paragraphs_admin_delete"
  on public.sermon_paragraphs for delete
  using (public.is_admin(auth.uid()));

create policy "sermon_aliases_select_via_sermon"
  on public.sermon_aliases for select
  using (
    exists (
      select 1 from public.sermons s
      where s.id = sermon_aliases.sermon_id
        and (s.is_published = true or public.is_admin(auth.uid()))
    )
  );

create policy "sermon_aliases_admin_all"
  on public.sermon_aliases for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "library_import_jobs_admin_select"
  on public.library_import_jobs for select
  using (public.is_admin(auth.uid()));

create policy "library_import_jobs_admin_insert"
  on public.library_import_jobs for insert
  with check (public.is_admin(auth.uid()));
