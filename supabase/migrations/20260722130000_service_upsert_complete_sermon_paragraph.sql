-- PostgREST uses a short statement timeout for ordinary writes. A few complete
-- source paragraphs need more time while PostgreSQL refreshes the search index.
-- Keep this path private to service_role and use it only after normal upserts
-- have exhausted their bounded retries.
create or replace function public.moboko_upsert_complete_sermon_paragraph(
  p_sermon_id uuid,
  p_paragraph_number integer,
  p_paragraph_text text,
  p_normalized_text text
)
returns void
language sql
security definer
set search_path = public, extensions
set statement_timeout = '120s'
as $$
  insert into public.sermon_paragraphs (
    sermon_id,
    paragraph_number,
    paragraph_text,
    normalized_text
  )
  values (
    p_sermon_id,
    p_paragraph_number,
    p_paragraph_text,
    p_normalized_text
  )
  on conflict (sermon_id, paragraph_number)
  do update set
    paragraph_text = excluded.paragraph_text,
    normalized_text = excluded.normalized_text;
$$;

revoke all on function public.moboko_upsert_complete_sermon_paragraph(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.moboko_upsert_complete_sermon_paragraph(uuid, integer, text, text) to service_role;
