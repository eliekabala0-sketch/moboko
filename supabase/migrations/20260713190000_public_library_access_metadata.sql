-- Finalize imported public library metadata with set-based updates.
-- Idempotent: safe to run after import repairs and after partial metadata syncs.

insert into public.bible_versions (
  name,
  abbreviation,
  language,
  testament_scope,
  source_file_path,
  source_file_name,
  total_books,
  total_chapters,
  total_verses,
  is_published,
  import_status,
  import_report,
  imported_at
)
select
  'Bible Louis Segond 1910',
  'LSG1910',
  'fr',
  'partial',
  'library-sources/bibles/bible-biblio-1910.pdf',
  'bible-biblio-1910.pdf',
  count(distinct book),
  count(distinct book || ':' || chapter::text),
  count(*),
  true,
  'needs_review',
  jsonb_build_object(
    'source', 'bible-biblio-1910.pdf',
    'status', 'partial',
    'note', 'This version contains the passages currently available in the Moboko library.',
    'total_books', count(distinct book),
    'total_chapters', count(distinct book || ':' || chapter::text),
    'total_verses', count(*)
  ),
  now()
from public.bible_passages
where translation = 'LSG1910'
on conflict (abbreviation) do update set
  name = excluded.name,
  language = excluded.language,
  testament_scope = excluded.testament_scope,
  source_file_path = excluded.source_file_path,
  source_file_name = excluded.source_file_name,
  total_books = excluded.total_books,
  total_chapters = excluded.total_chapters,
  total_verses = excluded.total_verses,
  is_published = true,
  import_status = excluded.import_status,
  import_report = excluded.import_report,
  imported_at = coalesce(public.bible_versions.imported_at, excluded.imported_at),
  updated_at = now();

with version_row as (
  select id
  from public.bible_versions
  where abbreviation = 'LSG1910'
)
update public.bible_passages bp
set
  version_id = v.id,
  book_name = coalesce(bp.book_name, bp.book),
  search_text = bp.book || ' ' || bp.chapter::text || ':' || bp.verse::text || ' ' || bp.text,
  validation_status = coalesce(bp.validation_status, 'valid')
from version_row v
where bp.translation = 'LSG1910';

with book_order(book_name, book_number) as (
  values
    ('Genese', 1),
    ('Genèse', 1),
    ('Exode', 2),
    ('Levitique', 3),
    ('Lévitique', 3),
    ('Nombres', 4),
    ('Deuteronome', 5),
    ('Deutéronome', 5),
    ('Josue', 6),
    ('Josué', 6),
    ('Juges', 7),
    ('Ruth', 8),
    ('1 Samuel', 9),
    ('2 Samuel', 10),
    ('1 Rois', 11),
    ('2 Rois', 12),
    ('1 Chroniques', 13),
    ('2 Chroniques', 14),
    ('Esdras', 15),
    ('Nehemie', 16),
    ('Néhémie', 16),
    ('Esther', 17),
    ('Job', 18),
    ('Psaumes', 19),
    ('Proverbes', 20),
    ('Ecclesiaste', 21),
    ('Ecclésiaste', 21),
    ('Cantique', 22),
    ('Esaie', 23),
    ('Esaïe', 23),
    ('Jeremie', 24),
    ('Jérémie', 24),
    ('Lamentations', 25),
    ('Ezechiel', 26),
    ('Ezéchiel', 26),
    ('Daniel', 27),
    ('Osee', 28),
    ('Osée', 28),
    ('Joel', 29),
    ('Joël', 29),
    ('Amos', 30),
    ('Abdias', 31),
    ('Jonas', 32),
    ('Michee', 33),
    ('Michée', 33),
    ('Nahum', 34),
    ('Habacuc', 35),
    ('Sophonie', 36),
    ('Aggee', 37),
    ('Aggée', 37),
    ('Zacharie', 38),
    ('Malachie', 39),
    ('Matthieu', 40),
    ('Marc', 41),
    ('Luc', 42),
    ('Jean', 43),
    ('Actes', 44),
    ('Romains', 45),
    ('1 Corinthiens', 46),
    ('2 Corinthiens', 47),
    ('Galates', 48),
    ('Ephesiens', 49),
    ('Ephésiens', 49),
    ('Philippiens', 50),
    ('Colossiens', 51),
    ('1 Thessaloniciens', 52),
    ('2 Thessaloniciens', 53),
    ('1 Timothee', 54),
    ('1 Timothée', 54),
    ('2 Timothee', 55),
    ('2 Timothée', 55),
    ('Tite', 56),
    ('Philemon', 57),
    ('Philémon', 57),
    ('Hebreux', 58),
    ('Hébreux', 58),
    ('Jacques', 59),
    ('1 Pierre', 60),
    ('2 Pierre', 61),
    ('1 Jean', 62),
    ('2 Jean', 63),
    ('3 Jean', 64),
    ('Jude', 65),
    ('Revelation', 66),
    ('Révélation', 66)
)
update public.bible_passages bp
set book_number = bo.book_number
from book_order bo
where bp.translation = 'LSG1910'
  and coalesce(bp.book_name, bp.book) = bo.book_name;

update public.hymn_books hb
set
  language = coalesce(hb.language, 'fr'),
  source_file_path = coalesce(hb.source_file_path, 'library-sources/hymns/' || hb.slug || '.pdf'),
  source_file_name = coalesce(hb.source_file_name, hb.slug || '.pdf'),
  total_hymns = totals.total_hymns,
  import_status = case when totals.conflict_count > 0 then 'needs_review' else 'imported' end,
  import_report = coalesce(nullif(hb.import_report, '{}'::jsonb), '{}'::jsonb)
    || jsonb_build_object(
      'total_hymns', totals.total_hymns,
      'conflict_count', totals.conflict_count,
      'status', case when totals.conflict_count > 0 then 'needs_review' else 'imported' end
    ),
  imported_at = coalesce(hb.imported_at, now())
from (
  select
    book_id,
    count(*)::integer as total_hymns,
    count(*) filter (where number like '%-conflit-%')::integer as conflict_count
  from public.hymns
  where book_id is not null
  group by book_id
) totals
where hb.id = totals.book_id;

update public.hymns h
set
  full_text = coalesce(h.full_text, h.lyrics),
  search_text = concat_ws(' ', hb.name, h.number, h.title, h.lyrics, h.chorus),
  validation_status = case
    when h.number like '%-conflit-%' then 'needs_review'
    else coalesce(h.validation_status, 'valid')
  end,
  validation_notes = case
    when h.number like '%-conflit-%'
      and not coalesce(h.validation_notes, '[]'::jsonb) @> '[{"type":"duplicate_number_conflict"}]'::jsonb
      then coalesce(h.validation_notes, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'duplicate_number_conflict',
          'note', 'Public display keeps the hymn visible with a readable suffix; admin review is still required.'
        )
      )
    else coalesce(h.validation_notes, '[]'::jsonb)
  end,
  display_order = coalesce(
    h.display_order,
    nullif(regexp_replace(coalesce(h.number, ''), '[^0-9].*$', ''), '')::integer
  )
from public.hymn_books hb
where h.book_id = hb.id;

create index if not exists hymns_public_book_display_idx
  on public.hymns (is_published, book_id, display_order, number);

create index if not exists hymns_public_title_idx
  on public.hymns (is_published, title);

create index if not exists bible_passages_translation_book_chapter_idx
  on public.bible_passages (translation, book, chapter, verse);

create index if not exists bible_versions_published_abbr_idx
  on public.bible_versions (is_published, abbreviation);

drop policy if exists "bible_passages_select_all" on public.bible_passages;
drop policy if exists "bible_passages_select_published_versions_or_admin" on public.bible_passages;
create policy "bible_passages_select_published_versions_or_admin"
  on public.bible_passages for select
  using (
    exists (
      select 1
      from public.bible_versions v
      where v.abbreviation = bible_passages.translation
        and v.is_published = true
    )
    or public.is_admin(auth.uid())
  );
