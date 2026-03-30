-- Recherche IA sermons : interrupteur public + coût en crédits (débit côté API service).

insert into public.app_settings (key, value) values
  ('sermon_ai_search_enabled', to_jsonb(true)),
  ('sermon_ai_search_credit_cost', to_jsonb(2))
on conflict (key) do nothing;

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
    'initial_free_credits',
    'sermon_ai_search_enabled',
    'sermon_ai_search_credit_cost'
  );
$$;
