# Supabase — sources versionnées

- `functions/voice-assistant/` : assistant vocal (v32). Tests locaux : `node --experimental-strip-types supabase/functions/voice-assistant/index.test.mjs` (Node ≥ 22, fetch simulé).
- `functions/resolve-site-images/` : URLs signées des photos du site public (v7).
- `functions/sync-calendars/` : import horaire des calendriers iCal Airbnb / Booking (v7 : réservations lues une seule fois, calendriers en parallèle, seules les lignes modifiées sont écrites).
- `migrations/` : migrations SQL appliquées sur le projet (dont `sync_signature`, empreinte légère utilisée par l’actualisation automatique).

Les fonctions sont déployées depuis Supabase. Ces fichiers servent de référence et d’historique ; ne pas les redéployer sans vérifier les secrets et la version en production.
