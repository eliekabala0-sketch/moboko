insert into public.app_settings (key, value) values
  ('support_other_amount_enabled', to_jsonb(true)),
  ('support_min_amount', to_jsonb(5)),
  ('support_max_amount', to_jsonb(1999))
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
    'sermon_ai_search_credit_cost',
    'free_normal_searches_per_month',
    'subscription_monthly_ai_credits',
    'support_suggested_amounts',
    'support_team_contact',
    'support_other_amount_enabled',
    'support_min_amount',
    'support_max_amount'
  );
$$;
