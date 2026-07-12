-- Restore early sermon scoping and make broad search branches progressive.

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
    regexp_replace(lower(unaccent(trim(coalesce(p_query, '')))), '[^[:alnum:]'' -]+', ' ', 'g') as query_norm,
    greatest(1, least(80, coalesce(p_limit, 20))) as lim,
    greatest(0, coalesce(p_offset, 0)) as off,
    least(220, greatest(50, greatest(1, least(80, coalesce(p_limit, 20))) * 6)) as branch_lim,
    nullif(trim(coalesce(p_sermon_slug, '')), '') as scope_slug,
    nullif(trim(coalesce(p_title_filter, '')), '') as title_filter,
    nullif(trim(coalesce(p_location_filter, '')), '') as location_filter,
    case when trim(coalesce(p_query, '')) ~ '^\d{1,5}$' then trim(coalesce(p_query, ''))::integer else null end as paragraph_lookup
),
terms as (
  select
    i.*,
    coalesce((
      select array_agg(w order by first_pos)
      from (
        select w, min(pos) as first_pos
        from regexp_split_to_table(i.query_norm, '\s+') with ordinality as parts(w, pos)
        where char_length(w) >= 3
          and w not in (
            'dans','avec','pour','cette','comme','entre','aussi','tout','tous',
            'toute','toutes','etre','etait','chez','plus','moins','trouve',
            'trouver','cherche','chercher','sermon','passage','paragraphe',
            'texte','vers','sont','est','aux','des','les','une','pas','sur',
            'par','que','qui','son','ses','leur','leurs'
          )
        group by w
      ) kept
    ), array[]::text[]) as important_words
  from input i
),
q_input as (
  select t.*, array_to_string(t.important_words[1:8], ' ') as important_query
  from terms t
),
queries as (
  select distinct trim(q) as q
  from q_input qi
  cross join lateral unnest(
    case
      when p_queries is not null and array_length(p_queries, 1) > 0 then array_prepend(qi.query_raw, p_queries)
      else array[qi.query_raw]
    end
  ) as raw_q(q)
  where char_length(trim(q)) >= 2
  limit 8
),
base_sermons as (
  select s.id, s.slug, s.title, s.year::integer as year, s.preached_on, s.location
  from public.sermons s
  cross join q_input qi
  where s.is_published = true
    and (qi.scope_slug is null or s.slug = qi.scope_slug)
    and (p_year is null or s.year = p_year)
    and (qi.title_filter is null or s.title ilike '%' || replace(replace(replace(qi.title_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
    and (qi.location_filter is null or s.location ilike '%' || replace(replace(replace(qi.location_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
),
paragraph_lookup_hits as (
  select s.slug, s.title, s.year, s.preached_on, s.location, p.sermon_id, p.paragraph_number, p.paragraph_text,
    0 as relevance_tier, 10::real as search_rank
  from q_input qi
  join base_sermons s on qi.paragraph_lookup is not null
  join public.sermon_paragraphs p on p.sermon_id = s.id and p.paragraph_number = qi.paragraph_lookup
  limit (select branch_lim from q_input)
),
exact_phrase_hits as (
  select s.slug, s.title, s.year, s.preached_on, s.location, p.sermon_id, p.paragraph_number, p.paragraph_text,
    1 as relevance_tier, 8::real as search_rank
  from q_input qi
  join base_sermons s on qi.paragraph_lookup is null and char_length(qi.query_norm) >= 3
  join public.sermon_paragraphs p
    on p.sermon_id = s.id
   and p.search_tsv @@ phraseto_tsquery('french', qi.query_raw)
   and position(qi.query_norm in p.normalized_text) > 0
  order by coalesce(s.preached_on, make_date(coalesce(s.year, 9999), 1, 1)) asc, s.title asc, p.paragraph_number asc
  limit (select branch_lim from q_input)
),
websearch_hits as (
  select s.slug, s.title, s.year, s.preached_on, s.location, p.sermon_id, p.paragraph_number, p.paragraph_text,
    2 as relevance_tier, ts_rank_cd(p.search_tsv, websearch_to_tsquery('french', q.q))::real as search_rank
  from q_input qi
  join queries q on qi.paragraph_lookup is null
    and not exists (select 1 from exact_phrase_hits)
  join base_sermons s on true
  join public.sermon_paragraphs p on p.sermon_id = s.id and p.search_tsv @@ websearch_to_tsquery('french', q.q)
  order by search_rank desc
  limit (select branch_lim from q_input)
),
important_word_hits as (
  select s.slug, s.title, s.year, s.preached_on, s.location, p.sermon_id, p.paragraph_number, p.paragraph_text,
    3 as relevance_tier, ts_rank_cd(p.search_tsv, plainto_tsquery('french', qi.important_query))::real as search_rank
  from q_input qi
  join base_sermons s on qi.paragraph_lookup is null
    and qi.important_query <> ''
    and not exists (select 1 from exact_phrase_hits)
    and not exists (select 1 from websearch_hits)
  join public.sermon_paragraphs p on p.sermon_id = s.id and p.search_tsv @@ plainto_tsquery('french', qi.important_query)
  order by search_rank desc
  limit (select branch_lim from q_input)
),
near_expression_hits as (
  select s.slug, s.title, s.year, s.preached_on, s.location, p.sermon_id, p.paragraph_number, p.paragraph_text,
    4 as relevance_tier, similarity(p.normalized_text, qi.query_norm)::real as search_rank
  from q_input qi
  join base_sermons s on qi.paragraph_lookup is null
    and char_length(qi.query_norm) >= 8
    and not exists (select 1 from exact_phrase_hits)
    and not exists (select 1 from websearch_hits)
    and not exists (select 1 from important_word_hits)
  join public.sermon_paragraphs p on p.sermon_id = s.id and p.normalized_text % qi.query_norm
  order by search_rank desc
  limit (select branch_lim from q_input)
),
unioned as (
  select * from paragraph_lookup_hits
  union all select * from exact_phrase_hits
  union all select * from websearch_hits
  union all select * from important_word_hits
  union all select * from near_expression_hits
),
deduped as (
  select slug, title, year, preached_on, location, sermon_id, paragraph_number, paragraph_text,
    min(relevance_tier) as relevance_tier, max(search_rank) as search_rank
  from unioned
  group by slug, title, year, preached_on, location, sermon_id, paragraph_number, paragraph_text
),
ranked as (
  select d.*, count(*) over () as total_count
  from deduped d
  order by relevance_tier asc, coalesce(preached_on, make_date(coalesce(year, 9999), 1, 1)) asc, title asc, paragraph_number asc, search_rank desc
  limit (select lim from q_input)
  offset (select off from q_input)
)
select
  r.slug, r.title, r.year, r.preached_on, r.location, r.paragraph_number, r.paragraph_text,
  prev_p.paragraph_number as prev_paragraph_number,
  prev_p.paragraph_text as prev_paragraph_text,
  next_p.paragraph_number as next_paragraph_number,
  next_p.paragraph_text as next_paragraph_text,
  r.relevance_tier, r.search_rank, r.total_count
from ranked r
left join public.sermon_paragraphs prev_p on prev_p.sermon_id = r.sermon_id and prev_p.paragraph_number = r.paragraph_number - 1
left join public.sermon_paragraphs next_p on next_p.sermon_id = r.sermon_id and next_p.paragraph_number = r.paragraph_number + 1
order by relevance_tier asc, coalesce(preached_on, make_date(coalesce(year, 9999), 1, 1)) asc, title asc, paragraph_number asc, search_rank desc;
$$;
