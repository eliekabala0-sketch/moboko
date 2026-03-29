-- Débit atomique des crédits (appelable uniquement avec la clé service_role côté serveur).
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
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select credit_balance into v_balance
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
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
