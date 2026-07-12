-- Admin-managed billing offers and checkout idempotency.

create table if not exists public.billing_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  name text not null,
  description text not null default '',
  user_visible_text text not null default '',
  price integer not null check (price >= 0),
  currency text not null default 'USD',
  duration_days integer not null default 30 check (duration_days > 0),
  benefits jsonb not null default '[]'::jsonb,
  normal_search_unlimited boolean not null default true,
  pdf_allowed boolean not null default true,
  monthly_ai_credits integer not null default 0 check (monthly_ai_credits >= 0),
  export_limit integer,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null
);

create table if not exists public.billing_credit_packs (
  id uuid primary key default gen_random_uuid(),
  pack_key text not null unique,
  name text not null,
  description text not null default '',
  credits integer not null check (credits > 0),
  bonus_credits integer not null default 0 check (bonus_credits >= 0),
  price integer not null check (price >= 0),
  currency text not null default 'USD',
  is_active boolean not null default true,
  is_featured boolean not null default false,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.payment_transactions
  add column if not exists idempotency_key text,
  add column if not exists offer_id uuid,
  add column if not exists provider_amount integer,
  add column if not exists provider_currency text;

create unique index if not exists payment_transactions_user_idempotency_unique
  on public.payment_transactions (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists billing_subscription_plans_active_order_idx
  on public.billing_subscription_plans (is_active, display_order, created_at desc);

create index if not exists billing_credit_packs_active_order_idx
  on public.billing_credit_packs (is_active, display_order, created_at desc);

drop trigger if exists billing_subscription_plans_updated_at on public.billing_subscription_plans;
create trigger billing_subscription_plans_updated_at
  before update on public.billing_subscription_plans
  for each row execute function public.set_updated_at();

drop trigger if exists billing_credit_packs_updated_at on public.billing_credit_packs;
create trigger billing_credit_packs_updated_at
  before update on public.billing_credit_packs
  for each row execute function public.set_updated_at();

alter table public.billing_subscription_plans enable row level security;
alter table public.billing_credit_packs enable row level security;

drop policy if exists "billing_subscription_plans_public_active_select" on public.billing_subscription_plans;
create policy "billing_subscription_plans_public_active_select"
  on public.billing_subscription_plans for select
  using (is_active or public.is_admin(auth.uid()));

drop policy if exists "billing_subscription_plans_admin_all" on public.billing_subscription_plans;
create policy "billing_subscription_plans_admin_all"
  on public.billing_subscription_plans for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "billing_credit_packs_public_active_select" on public.billing_credit_packs;
create policy "billing_credit_packs_public_active_select"
  on public.billing_credit_packs for select
  using (is_active or public.is_admin(auth.uid()));

drop policy if exists "billing_credit_packs_admin_all" on public.billing_credit_packs;
create policy "billing_credit_packs_admin_all"
  on public.billing_credit_packs for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

insert into public.billing_subscription_plans (
  plan_key,
  name,
  description,
  user_visible_text,
  price,
  currency,
  duration_days,
  benefits,
  normal_search_unlimited,
  pdf_allowed,
  monthly_ai_credits,
  export_limit,
  is_active,
  is_featured,
  display_order
)
values (
  'pdf_monthly',
  'Standard',
  'Acces mensuel aux fonctions documentaires Moboko.',
  'Recherche normale illimitee et telechargements PDF pendant 30 jours.',
  500,
  'USD',
  30,
  '["Recherche normale illimitee", "Telechargements PDF"]'::jsonb,
  true,
  true,
  0,
  null,
  true,
  true,
  10
)
on conflict (plan_key) do update set
  name = excluded.name,
  description = excluded.description,
  user_visible_text = excluded.user_visible_text,
  price = excluded.price,
  currency = excluded.currency,
  duration_days = excluded.duration_days,
  benefits = excluded.benefits,
  normal_search_unlimited = excluded.normal_search_unlimited,
  pdf_allowed = excluded.pdf_allowed,
  monthly_ai_credits = excluded.monthly_ai_credits,
  export_limit = excluded.export_limit,
  is_active = excluded.is_active,
  is_featured = excluded.is_featured,
  display_order = excluded.display_order;

insert into public.billing_credit_packs (
  pack_key,
  name,
  description,
  credits,
  bonus_credits,
  price,
  currency,
  is_active,
  is_featured,
  display_order
)
values (
  'starter_20',
  'Pack 20',
  '20 credits IA pour les fonctions assistees.',
  20,
  0,
  300,
  'USD',
  true,
  true,
  10
)
on conflict (pack_key) do update set
  name = excluded.name,
  description = excluded.description,
  credits = excluded.credits,
  bonus_credits = excluded.bonus_credits,
  price = excluded.price,
  currency = excluded.currency,
  is_active = excluded.is_active,
  is_featured = excluded.is_featured,
  display_order = excluded.display_order;
