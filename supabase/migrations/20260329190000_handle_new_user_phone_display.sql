-- Complète le nom d’affichage pour les comptes créés par téléphone (auth.users.phone)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'user_name',
      split_part(new.email, '@', 1),
      new.phone
    ),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;
