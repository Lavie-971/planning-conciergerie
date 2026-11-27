-- Empreinte légère des données synchronisées (réservations + logements) du compte connecté.
-- Permet à l'application de savoir en une seule requête minuscule si quelque chose a changé,
-- au lieu de retélécharger toutes les tables à chaque actualisation automatique.
-- SECURITY INVOKER : la RLS s'applique, chaque utilisateur ne voit que l'empreinte de ses propres lignes.
create or replace function public.sync_signature()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select concat_ws('|',
    coalesce((select max(updated_at)::text from public.bookings), ''),
    (select count(*) from public.bookings)::text,
    coalesce((select max(updated_at)::text from public.apartments), ''),
    (select count(*) from public.apartments)::text
  );
$$;

revoke all on function public.sync_signature() from public, anon;
grant execute on function public.sync_signature() to authenticated;
