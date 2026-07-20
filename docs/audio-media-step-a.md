# Phase mediatheque audio - Etape A

Date: 2026-07-20

## Inventaire reel

Sources lues sans modification:

- `D:\AUDIO\SERMENT WMB`
- `D:\AUDIO\PREDICATION\LIGNE_DE_PRIERE_DU_PROPHETE`

Rapports generes hors Git:

- `scripts/audio-import/reports/20260720-174318-summary.json`
- `scripts/audio-import/reports/20260720-174318-audio-inventory.csv`
- `scripts/audio-import/reports/20260720-174318-probable-duplicates.csv`

Ces rapports sont ignores par `.gitignore`.

## Comptes

| Source | Total fichiers | Audios | Non-audio | Taille |
| --- | ---: | ---: | ---: | ---: |
| Sermons WMB | 148 | 147 | 1 | 7,779,457,223 octets |
| Lignes de priere | 27 | 27 | 0 | 612,523,992 octets |
| Total | 175 | 174 | 1 | 8,391,981,215 octets |

Taille audio seule:

- sermons audio: 7,779,441,096 octets, soit environ 7.78 GB
- lignes de priere: 612,523,992 octets, soit environ 0.61 GB
- total audio: 8,391,965,088 octets, soit environ 8.39 GB

## Formats detectes

| Categorie | Format | Nombre |
| --- | --- | ---: |
| sermons | `.m4a` | 99 |
| sermons | `.mp3` | 48 |
| lignes de priere | `.mp3` | 27 |
| sermons | `.docx` | 1 |

Le fichier non-audio detecte est:

- `D:\AUDIO\SERMENT WMB\RAPPORT DE LA MISSION DE RECOUVVREMENT BADIBANGA (Enregistré automatiquement).docx`

Il doit etre exclu de tout import audio.

## Annees detectees depuis les noms

Les noms au format `FRNYY-MMDD...` donnent la repartition suivante:

| Annee | Audios |
| ---: | ---: |
| 1954 | 1 |
| 1955 | 1 |
| 1957 | 2 |
| 1958 | 1 |
| 1959 | 15 |
| 1960 | 13 |
| 1961 | 11 |
| 1962 | 16 |
| 1963 | 27 |
| 1964 | 36 |
| 1965 | 51 |

## Doublons

Doublons exacts:

- Aucun groupe de fichiers audio avec taille identique n'a ete trouve.
- Comme deux doublons exacts byte-a-byte auraient necessairement la meme taille, aucun doublon exact candidat n'a ete detecte dans cette passe.
- La passe SHA-256 globale a ete arretee car trop longue sur le disque local. Elle doit etre relancee par lots pendant l'import pilote ou via une option de reprise.

Doublons probables:

- 21 groupes par titre normalise.
- Ils correspondent surtout a des titres presents a la fois dans `sermons` et `prayer_line`, ou en double format `.m4a` / `.mp3`.
- Ces groupes ne doivent pas etre supprimes automatiquement. Ils doivent etre importes comme items distincts si la categorie ou le format a une utilite, ou marques `manual_review` si le doublon logique est incertain.

## Durees, codecs et bitrate

`ffprobe` et `ffmpeg` ne sont pas disponibles dans cette session.

Une tentative via les proprietes Windows Shell a ete trop lente et a ete abandonnee. Pour l'import pilote, la duree, le codec et le bitrate doivent etre mesures avec une sonde dediee, idealement `ffprobe`, sans modifier les originaux.

## Capacite Supabase

Volume audio brut: environ 8.39 GB.

Selon la documentation Supabase consultee le 2026-07-20:

- Free: 1 GB Storage, 5 GB egress.
- Pro: 100 GB Storage, 250 GB egress et 250 GB cached egress.
- Depassement Pro Storage: environ 0.0213 USD / GB / mois.

Conclusion:

- Si le projet Moboko est en Pro, le stockage brut de ce lot tient largement dans les 100 GB inclus.
- Si le projet est en Free, l'import complet ne tient pas.
- Le cout critique a surveiller sera l'egress audio, pas la taille initiale.

## Architecture retenue

Stockage:

- Bucket Supabase Storage prive: `sermon-audio`.
- Chemins:
  - `sermons/{year}/{safe_filename}`
  - `prayer-lines/{year-or-group}/{safe_filename}`
- Aucun audio dans Git, Next, PWA manifest, package mobile, public assets ou PostgreSQL.
- PostgreSQL conserve uniquement les metadonnees.

Acces:

- URLs signees courtes generees cote serveur.
- Verification serveur obligatoire avant streaming, offline ou telechargement complet.
- Pas de lien public permanent.
- Range requests a conserver pour le streaming progressif.

## Schema prevu

Migration a creer en etape B, par exemple:

- `supabase/migrations/20260720xxxx_audio_library.sql`

Tables:

- `audio_items`
- `audio_import_runs`
- `audio_import_events`
- `audio_progress`
- `audio_offline_records`
- `audio_transcripts`
- `audio_transcript_segments`

Extensions des plans:

- `billing_subscription_plans.audio_streaming`
- `billing_subscription_plans.audio_offline_in_app`
- `billing_subscription_plans.audio_full_download`
- `billing_subscription_plans.audio_search`

Acces individuel possible via une table optionnelle:

- `user_audio_access_overrides`

## Association audio / sermon texte

Strategie:

1. Extraire le code `FRNYY-MMDD[A-Z]?`.
2. Convertir `YY` en annee Branham probable: `54 -> 1954`, etc.
3. Normaliser titre audio et titres sermons: accents, tirets, underscores, ponctuation, casse.
4. Tenter correspondance forte par date + titre.
5. Tenter correspondance probable par similarite titre + annee.
6. Ne jamais lier automatiquement sous seuil de confiance.

Etats:

- `matched`
- `probable_match`
- `unmatched`
- `manual_review`

Les lignes de priere restent dans une categorie distincte et ne sont pas injectees dans l'Assistant doctrinal.

## Droits d'abonnement

Droits independants:

- `audio_streaming`
- `audio_offline_in_app`
- `audio_full_download`
- `audio_search`

Le client n'est jamais autorite. Les endpoints serveur verifient:

- session utilisateur;
- abonnement actif;
- date d'expiration;
- droit demande;
- audio actif;
- categorie autorisee.

## Offline PWA

Strategie:

- Audios stockes uniquement sur action explicite de l'utilisateur.
- Utiliser IndexedDB, Cache Storage dedie ou OPFS selon compatibilite.
- Ne pas mettre les audios dans le cache general du service worker.
- Page `Mes telechargements` avec taille, derniere ecoute, suppression, espace utilise.
- Validation periodique des droits.

## Telechargement complet

Mode separe du offline interne:

- endpoint serveur dedie;
- URL signee courte;
- `Content-Disposition: attachment`;
- nom de fichier propre;
- reserve aux plans avec `audio_full_download`.

## Lot pilote propose

Importer d'abord:

- 3 sermons `.m4a` de tailles differentes;
- 2 sermons `.mp3`;
- 2 lignes de priere `.mp3`;
- au moins 1 groupe probable `.m4a` + `.mp3` pour tester l'arbitrage;
- 1 item `unmatched` pour verifier l'administration.

Exemples candidats:

- `FRN64-0802 The Future Home Of The Heavenly Bridegroom And The Earthly Bride VGR.m4a`
- `FRN63-1226 Church Order VGR.m4a`
- `FRN63-1226 Church Order VGR.mp3`
- `FRN64-0305 Perseverant VGR.m4a`
- `FRN64-0305 Perseverant VGR.mp3`
- une ligne de priere portant le meme titre pour verifier la separation categorie.

## Blocages et limites

- `ffprobe` absent: duree totale, codec et bitrate non calcules de facon fiable.
- Capacite reelle du projet Supabase non lue via API de gestion dans cette passe; seuls les quotas publics ont ete verifies.
- SHA-256 global trop lent sur ce disque; aucune paire de taille identique n'a ete detectee, donc aucun doublon exact candidat, mais le hash doit etre calcule par lots dans l'import pilote.
