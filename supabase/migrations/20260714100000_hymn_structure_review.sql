alter table public.hymns
  add column if not exists confidence_score text,
  add column if not exists source_mapping jsonb not null default '{}'::jsonb,
  add column if not exists structure_anomalies jsonb not null default '[]'::jsonb,
  add column if not exists structure_proposal jsonb not null default '{}'::jsonb,
  add column if not exists structure_checked_at timestamptz;

create table if not exists public.hymn_structure_history (
  id uuid primary key default gen_random_uuid(),
  hymn_id uuid not null references public.hymns(id) on delete cascade,
  previous_verses jsonb not null default '[]'::jsonb,
  previous_chorus text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  source text not null default 'automatic_restructure',
  snapshot jsonb not null default '{}'::jsonb
);

create index if not exists hymn_structure_history_hymn_idx
  on public.hymn_structure_history (hymn_id, changed_at desc);

create index if not exists hymns_structure_review_idx
  on public.hymns (validation_status, confidence_score, book_id, display_order);

alter table public.hymn_structure_history enable row level security;

drop policy if exists "hymn_structure_history_admin_select" on public.hymn_structure_history;
create policy "hymn_structure_history_admin_select"
  on public.hymn_structure_history for select
  using (public.is_admin(auth.uid()));

drop policy if exists "hymn_structure_history_admin_insert" on public.hymn_structure_history;
create policy "hymn_structure_history_admin_insert"
  on public.hymn_structure_history for insert
  with check (public.is_admin(auth.uid()) or auth.uid() is null);

drop policy if exists "hymn_structure_history_admin_delete" on public.hymn_structure_history;
create policy "hymn_structure_history_admin_delete"
  on public.hymn_structure_history for delete
  using (public.is_admin(auth.uid()));

update public.hymns
set
  confidence_score = coalesce(confidence_score, case when validation_status = 'valid' then 'medium' else 'low' end),
  structure_anomalies = case
    when validation_status = 'valid' then coalesce(structure_anomalies, '[]'::jsonb)
    else coalesce(structure_anomalies, validation_notes, '[]'::jsonb)
  end
where confidence_score is null
   or structure_anomalies is null;
