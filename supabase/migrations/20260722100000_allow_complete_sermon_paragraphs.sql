-- Long official paragraphs can exceed PostgreSQL's B-tree tuple limit when the
-- full text is stored as an INCLUDE column. Keep the lookup index narrow; the
-- text remains in the table and full-text/trigram searches retain their own
-- dedicated indexes.
drop index if exists public.sermon_paragraphs_sermon_num_cover_idx;

create index if not exists sermon_paragraphs_sermon_num_cover_idx
  on public.sermon_paragraphs (sermon_id, paragraph_number);
