-- Allow ChatGPT-style conversation history: multiple conversations per user.
drop index if exists public.conversations_user_id_unique;

alter table public.conversations
  add column if not exists archived_at timestamptz;

create index if not exists conversations_user_updated_at_idx
  on public.conversations (user_id, updated_at desc);

create index if not exists conversations_user_archived_updated_at_idx
  on public.conversations (user_id, archived_at, updated_at desc);
