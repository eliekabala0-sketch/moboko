-- Preserve the semantic color information exported by Shekinah/Folio.
-- The UI may use this later without reparsing the original RTF.
alter table public.bible_passages
  add column if not exists has_words_of_jesus boolean not null default false;

comment on column public.bible_passages.has_words_of_jesus is
  'True when the Shekinah/Folio source marks at least part of the verse as words spoken by Jesus.';
