alter table public.conversations
  add column if not exists assistant_state jsonb not null default '{}'::jsonb;

create index if not exists conversations_assistant_state_gin
  on public.conversations using gin (assistant_state);
