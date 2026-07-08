-- Harden provider integration: idempotent webhook events and richer transactions.

alter table public.payment_transactions
  add column if not exists checkout_url text,
  add column if not exists credits integer,
  add column if not exists plan_key text,
  add column if not exists provider_event_id text,
  add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_provider_external_unique'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_provider_external_unique unique (provider, external_id);
  end if;
end $$;

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  status text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  constraint payment_webhook_events_provider_event_unique unique (provider, event_id)
);

create index if not exists payment_webhook_events_created_idx
  on public.payment_webhook_events (created_at desc);

alter table public.payment_webhook_events enable row level security;

drop policy if exists "payment_webhook_events_admin_select" on public.payment_webhook_events;
create policy "payment_webhook_events_admin_select"
  on public.payment_webhook_events for select
  using (public.is_admin(auth.uid()));

drop policy if exists "payment_webhook_events_admin_all" on public.payment_webhook_events;
create policy "payment_webhook_events_admin_all"
  on public.payment_webhook_events for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
