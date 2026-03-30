# Auth Moboko — configuration Supabase et fournisseurs

Le code utilise **un seul projet Supabase** pour tous les modes de connexion (`auth.users` + trigger `handle_new_user` → `profiles`). Aucun refactor métier côté crédits / historique.

## URLs de production (Railway)

- Site Next.js : `https://moboko-production.up.railway.app`
- Callback OAuth web : `https://moboko-production.up.railway.app/auth/callback`
- Schéma mobile (deep link) : `moboko` — URI typique : `moboko://auth/callback` (généré par Expo)

Dans **Supabase → Authentication → URL configuration** :

| Champ | Valeur recommandée |
|--------|---------------------|
| Site URL | `https://moboko-production.up.railway.app` |
| Redirect URLs | `https://moboko-production.up.railway.app/**` ; `https://moboko-production.up.railway.app/auth/callback` ; `moboko://**` ; `exp://**` (dev Expo si besoin) |

Ne pas utiliser `http://localhost:3000` en production pour les flux déployés ; le garder uniquement pour le dev local si vous testez en local.

## Confirmation e-mail (lancement fluide)

Pour **ne pas bloquer** l’accès après inscription e-mail / OAuth :

- **Authentication → Providers → Email** : désactiver *Confirm email* (ou équivalent) si vous voulez une session immédiate au lancement.
- Si la confirmation reste activée, les comptes e-mail sans confirmation n’auront pas de session jusqu’au clic sur le lien — documenté dans l’UI (message optionnel).

Les flux **Google, Apple, téléphone** ne dépendent pas de cette confirmation.

## Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) : créer des identifiants OAuth 2.0 (application Web + iOS/Android si besoin côté natif).
2. **Authorized redirect URIs** : l’URL fournie par Supabase (voir **Authentication → Providers → Google → Callback URL** ou documentation Supabase Auth).
3. Coller **Client ID** et **Client Secret** dans Supabase (provider Google, activé).

## Sign in with Apple (iCloud)

1. [Apple Developer](https://developer.apple.com/) : Services ID, clé Sign in with Apple, domaine et URL de retour selon les exigences Apple.
2. Supabase : **Authentication → Providers → Apple** : renseigner Services ID, clé, etc., comme indiqué dans la doc Supabase.
3. Ajouter le **redirect callback Supabase** / domaines dans la config Apple.

## Téléphone (SMS)

1. **Authentication → Providers → Phone** : activer.
2. Configurer le fournisseur SMS (Twilio, MessageBird, etc.) selon les instructions Supabase.
3. L’app envoie déjà `signInWithOtp` / `verifyOtp` avec numéro **E.164** (`+33…`).

## Variables d’environnement (rappel)

- **Web (Railway)** : `NEXT_PUBLIC_SUPABASE_*`, `NEXT_PUBLIC_SITE_URL`, secrets serveur inchangés.
- **Mobile** : `EXPO_PUBLIC_SUPABASE_*` ; `EXPO_PUBLIC_API_BASE_URL` et `EXPO_PUBLIC_SITE_URL` optionnels si vous surchargez le défaut `app.config.ts` / `@moboko/shared`.
