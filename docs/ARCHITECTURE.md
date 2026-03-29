# Moboko — Architecture technique

Application spirituelle **Moboko** : clients **Expo (React Native)** et **Next.js (web)**, backend **Supabase** (Postgres, Auth, Storage, Realtime), intelligence artificielle **OpenAI** exclusivement côté serveur.

## 1. Vue d’ensemble

```
┌─────────────────┐     ┌─────────────────┐
│  Expo (mobile)  │     │ Next.js (web)   │
│  React Native   │     │ App Router      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │    Supabase JS (anon) │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │ Supabase              │
         │ · Auth (JWT + RLS)    │
         │ · Postgres            │
         │ · Storage (médias)    │
         │ · Realtime (projection)│
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │ Couche IA (serveur)   │
         │ Edge Functions et/ou  │
         │ Route Handlers Next   │
         │ · OPENAI_API_KEY      │
         │ · Whisper / Vision    │
         └───────────────────────┘
```

**Principe non négociable** : la clé OpenAI et toute logique modèle (chat, transcription, vision) résident uniquement sur **Edge Functions Supabase** et/ou **API routes Next.js** protégées (session utilisateur vérifiée, débit crédits côté serveur).

## 2. Monorepo

| Chemin | Rôle |
|--------|------|
| `apps/web` | Next.js 16+, App Router, UI web, routes API proxy/IA si besoin, écran projection audience |
| `apps/mobile` | Expo, UI mobile, mêmes flux métier |
| `packages/shared` | Types TypeScript, constantes, schémas de validation (Zod) partagés |
| `supabase/migrations` | Schéma SQL, RLS, buckets Storage, publication Realtime |

Les design tokens (couleurs, rayons, typographie) sont dupliqués de façon cohérente (objet thème partagé dans `packages/shared` + Tailwind sur web + StyleSheet sur mobile) pour un rendu **premium** aligné sans imposer une lib UI cross-platform lourde en phase 1.

## 3. Modules produit ↔ briques techniques

| Module | Implémentation |
|--------|----------------|
| Authentification | Supabase Auth ; table `profiles` + trigger `auth.users` ; rôle `admin` en colonne `profiles.role` |
| Chat IA | Tables `conversations`, `messages` ; médias dans Storage (`chat-audio`, `chat-images`) ; Edge Function `chat` : assemblage historique, appels OpenAI, débit crédits |
| Publications | Table `posts`, RLS lecture publique si `published`, écriture admin |
| Projection temps réel | `projection_sessions`, `projection_items` ; client souscrit aux changements Realtime ; écran conducteur (admin) + écran audience plein écran |
| Admin | Routes `/admin/*` (web) ; rôle vérifié via RLS + middleware Next ; mobile : section réservée admin optionnelle |
| Abonnements / crédits | `subscriptions`, `credit_logs` ; intégration prestataire (Stripe, etc.) dans une étape ultérieure via webhooks → tables |
| Paramètres | `app_settings` : clés publiques documentées dans `packages/shared` (`home_hero_*`, flags chat, coûts crédits par type de message) ; valeurs scalaires JSON |

## 4. Données et RLS (résumé)

- **profiles** : l’utilisateur lit/édite sa ligne ; les admins lisent tout (politique dédiée).
- **conversations / messages** : accès par `user_id` / jointure conversation ; pas d’accès croisé entre utilisateurs.
- **posts** : lecture publique des contenus publiés ; écriture réservée aux admins.
- **projection_*** : conducteur (créateur ou admin) en écriture ; audience en lecture selon session (ex. `status = 'live'` + code ou slug).
- **subscriptions / credit_logs** : utilisateur voit ses lignes ; admins voient tout.
- **app_settings** : lecture publique (anon) pour les clés listées dans `app_setting_is_public_readable` ; écriture admin uniquement.

## 5. Stockage fichiers

| Bucket | Usage | Accès |
|--------|--------|--------|
| `branding` | Image d’accueil (paramétrable admin) | Public lecture |
| `chat-audio` | Messages vocaux | Authentifié, chemins user-scoped |
| `chat-images` | Pièces jointes chat | Idem |
| `post-covers` | Couvertures d’articles | Public lecture ; écriture admin |
| `post-images` | Images / médias d’articles | Public lecture ; écriture admin |

## 6. Realtime

Tables `projection_sessions` et `projection_items` ajoutées à la publication `supabase_realtime` pour synchronisation conducteur ↔ audience.

## 7. Sécurité IA

1. Client envoie uniquement des **JWT Supabase** vers les endpoints IA.
2. Le serveur vérifie le JWT, charge le profil, vérifie les **crédits**, puis appelle OpenAI.
3. Transcription (Whisper) et analyse d’image (GPT-4o ou équivalent) s’exécutent **côté serveur** sur fichiers déjà uploadés dans Storage (URLs signées ou lecture service role dans la fonction).

## 8. Ordre d’implémentation (suite)

1. ✅ Architecture + arborescence + SQL  
2. Lier projet Supabase (`supabase link`) et appliquer migrations  
3. Auth + rôles + écrans onboarding  
4. Shell UI premium (layout, navigation, thème)  
5. Chat IA complet (upload, historique, streaming optionnel)  
6. Module projection + pages plein écran  
7. Admin, paramètres, crédits, abonnements  

## 9. Branding

- Icône application : fichier **`assets/icon.png`** (et adaptive icon Android) = logo **Badiboss** — à placer manuellement dans `apps/mobile/assets/` (fichiers binaires non générés ici).
- Visuel d’accueil : jamais en dur ; URL et textes via **`home_hero_image_url`**, **`home_hero_title`**, **`home_hero_subtitle`** dans `app_settings` (fichier hébergé dans le bucket `branding`).
