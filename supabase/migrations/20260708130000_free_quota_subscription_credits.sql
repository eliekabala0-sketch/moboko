-- Monthly free normal-search quota and optional subscription AI credits.

create table if not exists public.normal_search_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  month_key text not null,
  search_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint normal_search_usage_user_month_unique unique (user_id, month_key),
  constraint normal_search_usage_count_nonnegative check (search_count >= 0)
);

create index if not exists normal_search_usage_user_month_idx
  on public.normal_search_usage (user_id, month_key);

create table if not exists public.subscription_credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  month_key text not null,
  credits integer not null,
  created_at timestamptz not null default now(),
  constraint subscription_credit_grants_user_month_unique unique (user_id, month_key),
  constraint subscription_credit_grants_positive check (credits > 0)
);

create index if not exists subscription_credit_grants_user_month_idx
  on public.subscription_credit_grants (user_id, month_key);

drop trigger if exists normal_search_usage_updated_at on public.normal_search_usage;
create trigger normal_search_usage_updated_at
  before update on public.normal_search_usage
  for each row execute function public.set_updated_at();

alter table public.normal_search_usage enable row level security;
alter table public.subscription_credit_grants enable row level security;

drop policy if exists "normal_search_usage_select_own_admin" on public.normal_search_usage;
create policy "normal_search_usage_select_own_admin"
  on public.normal_search_usage for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "normal_search_usage_admin_all" on public.normal_search_usage;
create policy "normal_search_usage_admin_all"
  on public.normal_search_usage for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "subscription_credit_grants_select_own_admin" on public.subscription_credit_grants;
create policy "subscription_credit_grants_select_own_admin"
  on public.subscription_credit_grants for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "subscription_credit_grants_admin_all" on public.subscription_credit_grants;
create policy "subscription_credit_grants_admin_all"
  on public.subscription_credit_grants for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

insert into public.app_settings (key, value) values
  ('free_normal_searches_per_month', to_jsonb(20)),
  ('subscription_monthly_ai_credits', to_jsonb(0))
on conflict (key) do nothing;

create or replace function public.app_setting_is_public_readable(k text)
returns boolean
language sql
immutable
as $$
  select k in (
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
    'subscription_monthly_ai_credits'
  );
$$;
