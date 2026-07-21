alter table public.posts
  add column if not exists post_type text not null default 'publication'
    check (post_type in ('publication', 'announcement', 'mass_message')),
  add column if not exists priority text not null default 'normal'
    check (priority in ('normal', 'high')),
  add column if not exists scheduled_at timestamptz,
  add column if not exists notify_on_publish boolean not null default false,
  add column if not exists notification_title text,
  add column if not exists notification_body text,
  add column if not exists notification_sent_at timestamptz;

alter table public.prayer_requests
  add column if not exists created_by_admin boolean not null default false,
  add column if not exists anonymous boolean not null default false;

alter table public.testimonies
  add column if not exists created_by_admin boolean not null default false,
  add column if not exists anonymous boolean not null default false;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  all_notifications boolean not null default true,
  important_announcements boolean not null default true,
  publications boolean not null default true,
  prayer_requests boolean not null default true,
  testimonies boolean not null default true,
  prayer_replies boolean not null default true,
  testimony_replies boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('publication', 'announcement', 'mass_message', 'prayer_request', 'testimony', 'prayer_reply', 'testimony_reply')),
  title text not null,
  body text not null,
  url text not null default '/',
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  post_id uuid references public.posts(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'opened', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id, is_active, updated_at desc);
create index if not exists notification_events_status_schedule_idx
  on public.notification_events (status, scheduled_at, created_at desc);
create index if not exists notification_deliveries_event_status_idx
  on public.notification_deliveries (event_id, status);
create index if not exists notification_deliveries_user_created_idx
  on public.notification_deliveries (user_id, created_at desc);

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists notification_events_updated_at on public.notification_events;
create trigger notification_events_updated_at
  before update on public.notification_events
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists "push_subscriptions_owner_all" on public.push_subscriptions;
create policy "push_subscriptions_owner_all" on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_admin_all" on public.push_subscriptions;
create policy "push_subscriptions_admin_all" on public.push_subscriptions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "notification_preferences_owner_all" on public.notification_preferences;
create policy "notification_preferences_owner_all" on public.notification_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notification_preferences_admin_select" on public.notification_preferences;
create policy "notification_preferences_admin_select" on public.notification_preferences for select
  using (public.is_admin(auth.uid()));

drop policy if exists "notification_events_admin_all" on public.notification_events;
create policy "notification_events_admin_all" on public.notification_events for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "notification_deliveries_owner_select" on public.notification_deliveries;
create policy "notification_deliveries_owner_select" on public.notification_deliveries for select
  using (user_id = auth.uid());

drop policy if exists "notification_deliveries_admin_all" on public.notification_deliveries;
create policy "notification_deliveries_admin_all" on public.notification_deliveries for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
