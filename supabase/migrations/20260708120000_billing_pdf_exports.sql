-- Billing/PDF foundation: provider-neutral user-facing model.

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  external_id text,
  amount integer,
  currency text,
  status text not null default 'pending',
  purpose text not null default 'subscription',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_transactions_external_unique unique (provider, external_id)
);

create index if not exists payment_transactions_user_created_idx
  on public.payment_transactions (user_id, created_at desc);

create table if not exists public.pdf_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  title text not null default 'Compilation Moboko',
  paragraph_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pdf_exports_user_created_idx
  on public.pdf_exports (user_id, created_at desc);

drop trigger if exists payment_transactions_updated_at on public.payment_transactions;
create trigger payment_transactions_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

alter table public.payment_transactions enable row level security;
alter table public.pdf_exports enable row level security;

drop policy if exists "payment_transactions_select_own_admin" on public.payment_transactions;
create policy "payment_transactions_select_own_admin"
  on public.payment_transactions for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "payment_transactions_admin_all" on public.payment_transactions;
create policy "payment_transactions_admin_all"
  on public.payment_transactions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "pdf_exports_select_own_admin" on public.pdf_exports;
create policy "pdf_exports_select_own_admin"
  on public.pdf_exports for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "pdf_exports_admin_all" on public.pdf_exports;
create policy "pdf_exports_admin_all"
  on public.pdf_exports for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
