-- Moboko — médias message + trigger updated_at sur app_settings
-- À appliquer sur une base où 20260328000000_initial_schema est déjà déployé.

-- Colonnes optionnelles pour un média principal (complément de `attachments` jsonb).
alter table public.messages
  add column if not exists media_bucket text,
  add column if not exists media_storage_path text,
  add column if not exists media_mime text,
  add column if not exists media_duration_ms integer,
  add column if not exists media_public_url text;

comment on column public.messages.content is
  'Texte utilisateur / assistant ou légende associée au média.';
comment on column public.messages.attachments is
  'JSON tableau : [{ bucket, path, mime, duration_ms?, public_url?, size_bytes? }] pour pièces jointes multiples.';
comment on column public.messages.metadata is
  'Métadonnées libres (ex. transcription, erreurs, ids externes).';
comment on column public.messages.media_bucket is
  'Bucket Storage du média principal (ex. chat-images, chat-audio).';
comment on column public.messages.media_storage_path is
  'Chemin objet du média principal (ex. {user_id}/file.ext).';
comment on column public.messages.media_mime is
  'Type MIME du média principal.';
comment on column public.messages.media_duration_ms is
  'Durée audio/vidéo en ms si applicable.';
comment on column public.messages.media_public_url is
  'URL publique en cache si bucket public ; sinon null (URL signée côté app).';

create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();
