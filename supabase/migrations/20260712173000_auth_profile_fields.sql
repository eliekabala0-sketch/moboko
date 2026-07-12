-- Profile fields for simplified email/phone password authentication.

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists sex text,
  add column if not exists city text,
  add column if not exists age integer,
  add column if not exists phone text,
  add column if not exists auth_identifier_type text,
  add column if not exists internal_auth_email text;

create unique index if not exists profiles_phone_unique
  on public.profiles (phone)
  where phone is not null and phone <> '';

create unique index if not exists profiles_internal_auth_email_unique
  on public.profiles (internal_auth_email)
  where internal_auth_email is not null and internal_auth_email <> '';

drop trigger if exists profiles_restrict_self_update_trigger on public.profiles;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    avatar_url,
    full_name,
    sex,
    city,
    age,
    phone,
    auth_identifier_type,
    internal_auth_email
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'sex',
    new.raw_user_meta_data->>'city',
    nullif(new.raw_user_meta_data->>'age', '')::integer,
    coalesce(new.raw_user_meta_data->>'phone', new.phone),
    new.raw_user_meta_data->>'auth_identifier_type',
    new.raw_user_meta_data->>'internal_auth_email'
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    full_name = excluded.full_name,
    sex = excluded.sex,
    city = excluded.city,
    age = excluded.age,
    phone = excluded.phone,
    auth_identifier_type = excluded.auth_identifier_type,
    internal_auth_email = excluded.internal_auth_email;
  return new;
end;
$$;
