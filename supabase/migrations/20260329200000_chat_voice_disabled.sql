-- Chat vocal désactivé temporairement (accès transcription OpenAI non disponible).
update public.app_settings
set value = to_jsonb(false)
where key = 'chat_voice_enabled';
