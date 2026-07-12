-- Sequential fast search: one indexable branch at a time, stop after first useful tier.

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
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_query_raw text := trim(coalesce(p_query, ''));
  v_query_norm text := regexp_replace(lower(unaccent(trim(coalesce(p_query, '')))), '[^[:alnum:]'' -]+', ' ', 'g');
  v_lim integer := greatest(1, least(80, coalesce(p_limit, 20)));
  v_off integer := greatest(0, coalesce(p_offset, 0));
  v_take integer := greatest(1, least(220, greatest(0, coalesce(p_offset, 0)) + greatest(1, least(80, coalesce(p_limit, 20))) + 1));
  v_scope_slug text := nullif(trim(coalesce(p_sermon_slug, '')), '');
  v_title_filter text := nullif(trim(coalesce(p_title_filter, '')), '');
  v_location_filter text := nullif(trim(coalesce(p_location_filter, '')), '');
  v_paragraph_lookup integer := case when trim(coalesce(p_query, '')) ~ '^\d{1,5}$' then trim(coalesce(p_query, ''))::integer else null end;
  v_important_query text;
  v_rows integer := 0;
begin
  select coalesce(array_to_string(array_agg(w order by first_pos), ' '), '')
  into v_important_query
  from (
    select w, min(pos) as first_pos
    from regexp_split_to_table(v_query_norm, '\s+') with ordinality as parts(w, pos)
    where char_length(w) >= 3
      and w not in (
        'dans','avec','pour','cette','comme','entre','aussi','tout','tous',
        'toute','toutes','etre','etait','chez','plus','moins','trouve',
        'trouver','cherche','chercher','sermon','passage','paragraphe',
        'texte','vers','sont','est','aux','des','les','une','pas','sur',
        'par','que','qui','son','ses','leur','leurs','où','ou'
      )
    group by w
    order by min(pos)
    limit 8
  ) kept;

  if v_query_raw = '' then
    return;
  end if;

  if v_paragraph_lookup is not null then
    return query
    with hits as materialized (
      select s.slug, s.title, s.year::integer as year, s.preached_on, s.location,
        p.sermon_id, p.paragraph_number, p.paragraph_text,
        0 as relevance_tier, 10::real as search_rank
      from public.sermon_paragraphs p
      join public.sermons s on s.id = p.sermon_id
      where p.paragraph_number = v_paragraph_lookup
        and s.is_published = true
        and (v_scope_slug is null or s.slug = v_scope_slug)
        and (p_year is null or s.year = p_year)
        and (v_title_filter is null or s.title ilike '%' || replace(replace(replace(v_title_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
        and (v_location_filter is null or s.location ilike '%' || replace(replace(replace(v_location_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
      order by coalesce(s.preached_on, make_date(coalesce(s.year, 9999), 1, 1)) asc, s.title asc, p.paragraph_number asc
      limit v_take
    ),
    page as (
      select h.*, count(*) over () as total_count
      from hits h
      offset v_off
      limit v_lim
    )
    select page.slug, page.title, page.year, page.preached_on, page.location, page.paragraph_number, page.paragraph_text,
      prev_p.paragraph_number, prev_p.paragraph_text,
      next_p.paragraph_number, next_p.paragraph_text,
      page.relevance_tier, page.search_rank, page.total_count
    from page
    left join public.sermon_paragraphs prev_p on prev_p.sermon_id = page.sermon_id and prev_p.paragraph_number = page.paragraph_number - 1
    left join public.sermon_paragraphs next_p on next_p.sermon_id = page.sermon_id and next_p.paragraph_number = page.paragraph_number + 1
    order by coalesce(page.preached_on, make_date(coalesce(page.year, 9999), 1, 1)) asc, page.title asc, page.paragraph_number asc;
    return;
  end if;

  if char_length(v_query_norm) >= 3 then
    return query
    with candidate as materialized (
      select p.sermon_id, p.paragraph_number, p.paragraph_text
      from public.sermon_paragraphs p
      where p.search_tsv @@ phraseto_tsquery('french', v_query_raw)
        and position(v_query_norm in p.normalized_text) > 0
      limit v_take
    ),
    hits as materialized (
      select s.slug, s.title, s.year::integer as year, s.preached_on, s.location,
        c.sermon_id, c.paragraph_number, c.paragraph_text,
        1 as relevance_tier, 8::real as search_rank
      from candidate c
      join public.sermons s on s.id = c.sermon_id
      where s.is_published = true
        and (v_scope_slug is null or s.slug = v_scope_slug)
        and (p_year is null or s.year = p_year)
        and (v_title_filter is null or s.title ilike '%' || replace(replace(replace(v_title_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
        and (v_location_filter is null or s.location ilike '%' || replace(replace(replace(v_location_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
      order by coalesce(s.preached_on, make_date(coalesce(s.year, 9999), 1, 1)) asc, s.title asc, c.paragraph_number asc
      limit v_take
    ),
    page as (
      select h.*, count(*) over () as total_count
      from hits h
      offset v_off
      limit v_lim
    )
    select page.slug, page.title, page.year, page.preached_on, page.location, page.paragraph_number, page.paragraph_text,
      prev_p.paragraph_number, prev_p.paragraph_text,
      next_p.paragraph_number, next_p.paragraph_text,
      page.relevance_tier, page.search_rank, page.total_count
    from page
    left join public.sermon_paragraphs prev_p on prev_p.sermon_id = page.sermon_id and prev_p.paragraph_number = page.paragraph_number - 1
    left join public.sermon_paragraphs next_p on next_p.sermon_id = page.sermon_id and next_p.paragraph_number = page.paragraph_number + 1
    order by coalesce(page.preached_on, make_date(coalesce(page.year, 9999), 1, 1)) asc, page.title asc, page.paragraph_number asc;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      return;
    end if;
  end if;

  return query
  with q as materialized (
    select distinct trim(x) as query_text
    from unnest(
      case
        when p_queries is not null and array_length(p_queries, 1) > 0 then array_prepend(v_query_raw, p_queries)
        else array[v_query_raw]
      end
    ) as raw(x)
    where char_length(trim(x)) >= 2
    limit 8
  ),
  candidate as materialized (
    select p.sermon_id, p.paragraph_number, p.paragraph_text,
      max(ts_rank_cd(p.search_tsv, websearch_to_tsquery('french', q.query_text)))::real as search_rank
    from q
    join public.sermon_paragraphs p on p.search_tsv @@ websearch_to_tsquery('french', q.query_text)
    group by p.sermon_id, p.paragraph_number, p.paragraph_text
    order by search_rank desc
    limit v_take
  ),
  hits as materialized (
    select s.slug, s.title, s.year::integer as year, s.preached_on, s.location,
      c.sermon_id, c.paragraph_number, c.paragraph_text,
      2 as relevance_tier, c.search_rank
    from candidate c
    join public.sermons s on s.id = c.sermon_id
    where s.is_published = true
      and (v_scope_slug is null or s.slug = v_scope_slug)
      and (p_year is null or s.year = p_year)
      and (v_title_filter is null or s.title ilike '%' || replace(replace(replace(v_title_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
      and (v_location_filter is null or s.location ilike '%' || replace(replace(replace(v_location_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
    order by coalesce(s.preached_on, make_date(coalesce(s.year, 9999), 1, 1)) asc, s.title asc, c.paragraph_number asc
    limit v_take
  ),
  page as (
    select h.*, count(*) over () as total_count
    from hits h
    offset v_off
    limit v_lim
  )
  select page.slug, page.title, page.year, page.preached_on, page.location, page.paragraph_number, page.paragraph_text,
    prev_p.paragraph_number, prev_p.paragraph_text,
    next_p.paragraph_number, next_p.paragraph_text,
    page.relevance_tier, page.search_rank, page.total_count
  from page
  left join public.sermon_paragraphs prev_p on prev_p.sermon_id = page.sermon_id and prev_p.paragraph_number = page.paragraph_number - 1
  left join public.sermon_paragraphs next_p on next_p.sermon_id = page.sermon_id and next_p.paragraph_number = page.paragraph_number + 1
  order by coalesce(page.preached_on, make_date(coalesce(page.year, 9999), 1, 1)) asc, page.title asc, page.paragraph_number asc;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return;
  end if;

  if v_important_query <> '' then
    return query
    with candidate as materialized (
      select p.sermon_id, p.paragraph_number, p.paragraph_text,
        ts_rank_cd(p.search_tsv, plainto_tsquery('french', v_important_query))::real as search_rank
      from public.sermon_paragraphs p
      where p.search_tsv @@ plainto_tsquery('french', v_important_query)
      order by search_rank desc
      limit v_take
    ),
    hits as materialized (
      select s.slug, s.title, s.year::integer as year, s.preached_on, s.location,
        c.sermon_id, c.paragraph_number, c.paragraph_text,
        3 as relevance_tier, c.search_rank
      from candidate c
      join public.sermons s on s.id = c.sermon_id
      where s.is_published = true
        and (v_scope_slug is null or s.slug = v_scope_slug)
        and (p_year is null or s.year = p_year)
        and (v_title_filter is null or s.title ilike '%' || replace(replace(replace(v_title_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
        and (v_location_filter is null or s.location ilike '%' || replace(replace(replace(v_location_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
      order by coalesce(s.preached_on, make_date(coalesce(s.year, 9999), 1, 1)) asc, s.title asc, c.paragraph_number asc
      limit v_take
    ),
    page as (
      select h.*, count(*) over () as total_count
      from hits h
      offset v_off
      limit v_lim
    )
    select page.slug, page.title, page.year, page.preached_on, page.location, page.paragraph_number, page.paragraph_text,
      prev_p.paragraph_number, prev_p.paragraph_text,
      next_p.paragraph_number, next_p.paragraph_text,
      page.relevance_tier, page.search_rank, page.total_count
    from page
    left join public.sermon_paragraphs prev_p on prev_p.sermon_id = page.sermon_id and prev_p.paragraph_number = page.paragraph_number - 1
    left join public.sermon_paragraphs next_p on next_p.sermon_id = page.sermon_id and next_p.paragraph_number = page.paragraph_number + 1
    order by coalesce(page.preached_on, make_date(coalesce(page.year, 9999), 1, 1)) asc, page.title asc, page.paragraph_number asc;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      return;
    end if;
  end if;

  if char_length(v_query_norm) >= 8 then
    return query
    with candidate as materialized (
      select p.sermon_id, p.paragraph_number, p.paragraph_text,
        similarity(p.normalized_text, v_query_norm)::real as search_rank
      from public.sermon_paragraphs p
      where p.normalized_text % v_query_norm
      order by search_rank desc
      limit v_take
    ),
    hits as materialized (
      select s.slug, s.title, s.year::integer as year, s.preached_on, s.location,
        c.sermon_id, c.paragraph_number, c.paragraph_text,
        4 as relevance_tier, c.search_rank
      from candidate c
      join public.sermons s on s.id = c.sermon_id
      where s.is_published = true
        and (v_scope_slug is null or s.slug = v_scope_slug)
        and (p_year is null or s.year = p_year)
        and (v_title_filter is null or s.title ilike '%' || replace(replace(replace(v_title_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
        and (v_location_filter is null or s.location ilike '%' || replace(replace(replace(v_location_filter, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
      order by coalesce(s.preached_on, make_date(coalesce(s.year, 9999), 1, 1)) asc, s.title asc, c.paragraph_number asc
      limit v_take
    ),
    page as (
      select h.*, count(*) over () as total_count
      from hits h
      offset v_off
      limit v_lim
    )
    select page.slug, page.title, page.year, page.preached_on, page.location, page.paragraph_number, page.paragraph_text,
      prev_p.paragraph_number, prev_p.paragraph_text,
      next_p.paragraph_number, next_p.paragraph_text,
      page.relevance_tier, page.search_rank, page.total_count
    from page
    left join public.sermon_paragraphs prev_p on prev_p.sermon_id = page.sermon_id and prev_p.paragraph_number = page.paragraph_number - 1
    left join public.sermon_paragraphs next_p on next_p.sermon_id = page.sermon_id and next_p.paragraph_number = page.paragraph_number + 1
    order by coalesce(page.preached_on, make_date(coalesce(page.year, 9999), 1, 1)) asc, page.title asc, page.paragraph_number asc;
  end if;
end;
$$;
