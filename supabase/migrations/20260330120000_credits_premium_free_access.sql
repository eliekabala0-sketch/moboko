-- Crédits pro : premium / accès gratuit, crédits initiaux à l'inscription, débit atomique ajusté.
-- La colonne existante credit_balance sert de solde « crédits » (pas de doublon credits).

alter table public.profiles
  add column if not exists is_premium boolean not null default false,
  add column if not exists is_free_access boolean not null default false;

alter table public.profiles
  alter column credit_balance set default 5;

comment on column public.profiles.credit_balance is 'Solde crédits (essai / achat Badiboss Pay).';
comment on column public.profiles.is_premium is 'Si true : chat sans débit de crédits.';
comment on column public.profiles.is_free_access is 'Si true : accès offert, sans débit.';

insert into public.app_settings (key, value) values
  ('initial_free_credits', to_jsonb(5))
on conflict (key) do nothing;

-- Lecture publique (affichage coûts / onboarding) alignée sur les autres clés chat.
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
    'initial_free_credits'
  );
$$;

-- Nouveau compte : crédits = initial_free_credits (app_settings), défaut 5.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initial integer;
begin
  select coalesce(
    (
      select (s.value #>> '{}')::integer
      from public.app_settings s
      where s.key = 'initial_free_credits'
      limit 1
    ),
    5
  ) into v_initial;

  if v_initial is null or v_initial < 0 then
    v_initial := 0;
  end if;

  insert into public.profiles (id, display_name, avatar_url, credit_balance)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    v_initial
  );
  return new;
end;
$$;

-- Empêcher un utilisateur non-admin de modifier rôle, solde, flags premium/gratuit.
create or replace function public.profiles_restrict_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if public.is_admin(auth.uid()) then
    return new;
  end if;
  if new.id = auth.uid() then
    if new.role is distinct from old.role
       or new.credit_balance is distinct from old.credit_balance
       or new.is_premium is distinct from old.is_premium
       or new.is_free_access is distinct from old.is_free_access
    then
      raise exception 'Mise à jour réservée à l''administration';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_restrict_self_update_trigger on public.profiles;
create trigger profiles_restrict_self_update_trigger
  before update on public.profiles
  for each row
  execute function public.profiles_restrict_self_update();

-- Débit : skip si premium ou accès gratuit (pas de ligne credit_logs).
create or replace function public.consume_credits_atomic(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_ref_type text default null,
  p_ref_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_new integer;
  v_premium boolean;
  v_free boolean;
begin
  if p_amount is null or p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select p.credit_balance, p.is_premium, p.is_free_access
  into v_balance, v_premium, v_free
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;

  if v_free or v_premium then
    return jsonb_build_object(
      'ok', true,
      'balance_after', v_balance,
      'billing_skipped', true
    );
  end if;

  if p_amount = 0 then
    return jsonb_build_object(
      'ok', true,
      'balance_after', v_balance,
      'billing_skipped', true
    );
  end if;

  if v_balance < p_amount then
    return jsonb_build_object(
      'ok', false,
      'error', 'insufficient_credits',
      'balance', v_balance
    );
  end if;

  v_new := v_balance - p_amount;

  update public.profiles
  set credit_balance = v_new
  where id = p_user_id;

  insert into public.credit_logs (user_id, delta, balance_after, reason, ref_type, ref_id)
  values (p_user_id, -p_amount, v_new, p_reason, p_ref_type, p_ref_id);

  return jsonb_build_object('ok', true, 'balance_after', v_new);
end;
$$;

revoke all on function public.consume_credits_atomic(uuid, integer, text, text, uuid) from public;
grant execute on function public.consume_credits_atomic(uuid, integer, text, text, uuid) to service_role;
