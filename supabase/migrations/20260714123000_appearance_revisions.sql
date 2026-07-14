create table if not exists public.appearance_revisions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  title text not null default 'Brouillon apparence',
  payload jsonb not null default '{}'::jsonb,
  restored_from uuid references public.appearance_revisions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appearance_revisions_status_updated_idx
  on public.appearance_revisions (status, updated_at desc);

alter table public.appearance_revisions enable row level security;

drop policy if exists "appearance_revisions_select_published_or_admin" on public.appearance_revisions;
create policy "appearance_revisions_select_published_or_admin"
  on public.appearance_revisions for select
  using (status = 'published' or public.is_admin(auth.uid()));

drop policy if exists "appearance_revisions_admin_all" on public.appearance_revisions;
create policy "appearance_revisions_admin_all"
  on public.appearance_revisions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop trigger if exists appearance_revisions_updated_at on public.appearance_revisions;
create trigger appearance_revisions_updated_at
  before update on public.appearance_revisions
  for each row execute function public.set_updated_at();

create or replace function public.app_setting_is_public_readable(k text)
returns boolean
language sql
stable
as $$
  select k = any(array[
    'home_hero_image_url',
    'home_hero_title',
    'home_hero_subtitle',
    'chat_text_enabled',
    'chat_voice_enabled',
    'chat_image_enabled',
    'text_credit_cost',
    'voice_credit_cost',
    'image_credit_cost',
    'initial_free_credits',
    'sermon_ai_search_enabled',
    'sermon_ai_search_credit_cost',
    'free_normal_searches_per_month',
    'subscription_monthly_ai_credits',
    'support_suggested_amounts',
    'support_team_contact',
    'support_other_amount_enabled',
    'support_min_amount',
    'support_max_amount',
    'appearance_published_revision_id'
  ]);
$$;

insert into public.app_settings (key, value)
values ('appearance_published_revision_id', 'null'::jsonb)
on conflict (key) do nothing;

insert into public.appearance_revisions (status, title, payload, published_at)
select
  'published',
  'Apparence initiale',
  jsonb_build_object(
    'brand', jsonb_build_object(
      'logoUrl', null,
      'faviconUrl', null,
      'siteName', 'Moboko'
    ),
    'images', jsonb_build_object(
      'heroImageUrl', null,
      'backgroundImageUrl', null,
      'objectPosition', 'center center',
      'focalX', 50,
      'focalY', 50,
      'zoom', 1,
      'overlayOpacity', 0.55
    ),
    'colors', jsonb_build_object(
      'accent', '#c9a962',
      'primary', '#5b7fc8'
    ),
    'pages', jsonb_build_object(
      'home', jsonb_build_object(
        'eyebrow', 'Moboko',
        'title', 'Votre compagnon spirituel, clair et respectueux',
        'highlight', 'clair et respectueux',
        'lead', 'Posez vos questions, explorez les enseignements, et vivez les temps forts en direct grace a l''assistant, avec une interface pensee pour la serenite et la lisibilite.',
        'primaryButton', 'Commencer',
        'primaryHref', '/auth',
        'secondaryButton', 'Assistant',
        'secondaryHref', '/chat',
        'heroKicker', coalesce((select value #>> '{}' from public.app_settings where key = 'home_hero_subtitle'), 'Chemin interieur'),
        'heroTitle', coalesce((select value #>> '{}' from public.app_settings where key = 'home_hero_title'), 'Une presence calme pour avancer avec clarte')
      ),
      'download', jsonb_build_object(
        'title', 'Installer Moboko',
        'lead', 'Accedez rapidement a l''Assistant, aux sermons, a la Bible, aux cantiques et a la projection depuis votre ecran d''accueil.',
        'primaryButton', 'Installer Moboko',
        'secondaryButton', 'Ouvrir Moboko'
      )
    ),
    'blocks', jsonb_build_array(
      jsonb_build_object('id', 'intro', 'label', 'Introduction', 'enabled', true, 'order', 1),
      jsonb_build_object('id', 'hero', 'label', 'Image principale', 'enabled', true, 'order', 2)
    )
  ),
  now()
where not exists (select 1 from public.appearance_revisions where status = 'published');

update public.app_settings s
set value = to_jsonb(r.id::text)
from (
  select id
  from public.appearance_revisions
  where status = 'published'
  order by published_at desc nulls last, created_at desc
  limit 1
) r
where s.key = 'appearance_published_revision_id'
  and (s.value is null or s.value = 'null'::jsonb);
