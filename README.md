# Moboko

Monorepo : **Expo** (`apps/mobile`), **Next.js** (`apps/web`), **Supabase** (`supabase/migrations`), partagé (`packages/shared`).

## Scaffolding (non interactif)

Depuis la racine du monorepo, recréer le web sans prompt :

```bash
set CI=true
npx create-next-app@latest apps/web --yes --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack --use-npm
```

(`--yes` et `CI=true` évitent toute question CLI, par ex. React Compiler.)

## Démarrage

1. Créer un projet sur [supabase.com](https://supabase.com), appliquer **toutes** les migrations dans `supabase/migrations/` (dont `20260329120000_messages_media_and_settings_trigger.sql` pour les colonnes média `messages` + trigger `app_settings`).
2. Copier `apps/web/.env.example` vers `apps/web/.env.local` et renseigner l’URL + **clé anon** (`NEXT_PUBLIC_SUPABASE_*`). Pour Expo : `apps/mobile/.env.local` avec `EXPO_PUBLIC_SUPABASE_*` (mêmes valeurs).
3. Vérifier la connexion réelle : `npm run verify:supabase` (lecture `app_settings`, RLS `profiles`, refus d’écriture anon). Pour tester aussi lecteur / écriture `profiles` avec JWT : ajoutez dans `.env.local` des comptes dédiés `MOBOKO_VERIFY_EMAIL` et `MOBOKO_VERIFY_PASSWORD`, ou désactivez temporairement la confirmation e-mail côté Supabase Auth.
4. À la racine : `npm install`
5. Web : `npm run dev:web`
6. Mobile : `npm run start:mobile`

Documentation d’architecture : `docs/ARCHITECTURE.md`.
