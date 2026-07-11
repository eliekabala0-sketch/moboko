-- Fast, tiered sermon search for normal and assisted search paths.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create index if not exists sermons_title_trgm_idx
  on public.sermons using gin (title gin_trgm_ops);

create index if not exists sermons_location_trgm_idx
  on public.sermons using gin (location gin_trgm_ops);

create index if not exists sermons_published_date_idx
  on public.sermons (is_published, preached_on asc nulls last, year asc nulls last);

create index if not exists sermon_paragraphs_normalized_trgm_idx
  on public.sermon_paragraphs using gin (normalized_text gin_trgm_ops);

create index if not exists sermon_paragraphs_sermon_num_cover_idx
  on public.sermon_paragraphs (sermon_id, paragraph_number)
  include (paragraph_text);

create or replace function public.moboko_search_sermon_paragraphs(
  p_query text,
  p_queries text[] default null,
  p_sermon_slug text default null,
  p_title_filter text default null,
  p_year integer default null,
  p_location_filter text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  slug text,
  title text,
  year integer,
  preached_on date,
  location text,
  paragraph_number integer,
  paragraph_text text,
  prev_paragraph_number integer,
  prev_paragraph_text text,
  next_paragraph_number integer,
  next_paragraph_text text,
  relevance_tier integer,
  search_rank real,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
with input as (
  select
    trim(coalesce(p_query, '')) as query_raw,
    regexp_replace(
      lower(unaccent(trim(coalesce(p_query, '')))),
      '[^[:alnum:]'' -]+',
      ' ',
      'g'
    ) as query_norm,
    greatest(1, least(100, coalesce(p_limit, 20))) as lim,
    greatest(0, coalesce(p_offset, 0)) as off,
    nullif(trim(coalesce(p_sermon_slug, '')), '') as scope_slug,
    nullif(trim(coalesce(p_title_filter, '')), '') as title_filter,
    nullif(trim(coalesce(p_location_filter, '')), '') as location_filter,
    case
      when trim(coalesce(p_query, '')) ~ '^\d{1,5}$'
        then trim(coalesce(p_query, ''))::integer
      else null
    end as paragraph_lookup
),
query_terms as (
  select
    i.*,
    coalesce(
      (
        select array_agg(distinct w order by w)
        from regexp_split_to_table(i.query_norm, '\s+') as w
        where char_length(w) >= 3
          and w not in (
            'dans','avec','pour','cette','comme','entre','aussi','tout','tous',
            'toute','toutes','etre','etait','chez','plus','moins','trouve',
            'trouver','cherche','chercher','sermon','passage','paragraphe',
            'texte','vers','sont','est','aux','des','les','une','pas','sur',
            'par','que','qui','son','ses','leur','leurs'
          )
      ),
      array[]::text[]
    ) as important_words
  from input i
),
queries as (
  select distinct on (q)
    q,
    qt.query_raw,
    qt.query_norm,
    qt.lim,
    qt.off,
    qt.scope_slug,
    qt.title_filter,
    qt.location_filter,
    qt.paragraph_lookup,
    array_to_string(qt.important_words[1:10], ' ') as important_query
  from query_terms qt
  cross join lateral unnest(
    case
      when p_queries is not null and array_length(p_queries, 1) > 0
        then array_prepend(qt.query_raw, p_queries)
      else array[qt.query_raw]
    end
  ) as raw_q(q)
  where char_length(trim(q)) >= 2
),
scored as (
  select
    s.slug,
    s.title,
    s.year::integer as year,
    s.preached_on,
    s.location,
    p.paragraph_number,
    p.paragraph_text,
    q.lim,
    q.off,
    min(
      case
        when q.paragraph_lookup is not null and p.paragraph_number = q.paragraph_lookup then 0
        when char_length(q.query_norm) >= 2 and position(q.query_norm in p.normalized_text) > 0 then 1
        when p.search_tsv @@ websearch_to_tsquery('french', q.q) then 2
        when q.important_query <> '' and p.search_tsv @@ plainto_tsquery('french', q.important_query) then 3
        when char_length(q.query_norm) >= 4 and p.normalized_text % q.query_norm then 4
        else 99
      end
    ) as relevance_tier,
    max(
      ts_rank_cd(p.search_tsv, websearch_to_tsquery('french', q.q))
      + case
          when q.important_query <> '' then ts_rank_cd(p.search_tsv, plainto_tsquery('french', q.important_query)) * 0.35
          else 0
        end
      + greatest(similarity(p.normalized_text, q.query_norm), 0) * 0.2
      + case when char_length(q.query_norm) >= 2 and position(q.query_norm in p.normalized_text) > 0 then 2 else 0 end
      + case when q.paragraph_lookup is not null and p.paragraph_number = q.paragraph_lookup then 4 else 0 end
    )::real as search_rank
  from queries q
  join public.sermons s
    on s.is_published = true
   and (q.scope_slug is null or s.slug = q.scope_slug)
   and (p_year is null or s.year = p_year)
   and (
     q.title_filter is null
     or s.title ilike '%' || replace(replace(replace(q.title_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
   )
   and (
     q.location_filter is null
     or s.location ilike '%' || replace(replace(replace(q.location_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
   )
  join public.sermon_paragraphs p on p.sermon_id = s.id
  where
    (q.paragraph_lookup is not null and p.paragraph_number = q.paragraph_lookup)
    or (char_length(q.query_norm) >= 2 and position(q.query_norm in p.normalized_text) > 0)
    or (p.search_tsv @@ websearch_to_tsquery('french', q.q))
    or (q.important_query <> '' and p.search_tsv @@ plainto_tsquery('french', q.important_query))
    or (char_length(q.query_norm) >= 4 and p.normalized_text % q.query_norm)
  group by
    s.slug, s.title, s.year, s.preached_on, s.location,
    p.sermon_id, p.paragraph_number, p.paragraph_text, q.lim, q.off
),
ranked as (
  select
    scored.*,
    count(*) over () as total_count
  from scored
  where relevance_tier < 99
  order by
    relevance_tier asc,
    coalesce(preached_on, make_date(coalesce(year, 9999), 1, 1)) asc,
    title asc,
    paragraph_number asc,
    search_rank desc
  limit (select lim from input)
  offset (select off from input)
)
select
  r.slug,
  r.title,
  r.year,
  r.preached_on,
  r.location,
  r.paragraph_number,
  r.paragraph_text,
  prev_p.paragraph_number as prev_paragraph_number,
  prev_p.paragraph_text as prev_paragraph_text,
  next_p.paragraph_number as next_paragraph_number,
  next_p.paragraph_text as next_paragraph_text,
  r.relevance_tier,
  r.search_rank,
  r.total_count
from ranked r
join public.sermons s on s.slug = r.slug and s.is_published = true
left join public.sermon_paragraphs prev_p
  on prev_p.sermon_id = s.id and prev_p.paragraph_number = r.paragraph_number - 1
left join public.sermon_paragraphs next_p
  on next_p.sermon_id = s.id and next_p.paragraph_number = r.paragraph_number + 1
order by
  r.relevance_tier asc,
  coalesce(r.preached_on, make_date(coalesce(r.year, 9999), 1, 1)) asc,
  r.title asc,
  r.paragraph_number asc,
  r.search_rank desc;
$$;

revoke all on function public.moboko_search_sermon_paragraphs(
  text, text[], text, text, integer, text, integer, integer
) from public;

grant execute on function public.moboko_search_sermon_paragraphs(
  text, text[], text, text, integer, text, integer, integer
) to anon, authenticated, service_role;
