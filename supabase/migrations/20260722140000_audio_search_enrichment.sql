alter table public.audio_items
  add column if not exists title_original text,
  add column if not exists sermon_code text,
  add column if not exists search_aliases text[] not null default '{}'::text[];

update public.audio_items
set title_original = title
where title_original is null or trim(title_original) = '';

create index if not exists audio_items_title_original_trgm_idx
  on public.audio_items using gin (title_original extensions.gin_trgm_ops);

create index if not exists audio_items_sermon_code_idx
  on public.audio_items (sermon_code)
  where sermon_code is not null;

create index if not exists audio_items_search_aliases_idx
  on public.audio_items using gin (search_aliases);

comment on column public.audio_items.title_original is
  'Original title read from the audio filename or source metadata. The linked sermons.title remains the official French display title.';

comment on column public.audio_items.sermon_code is
  'Normalized VGR sermon code, including the morning/evening suffix when present.';
