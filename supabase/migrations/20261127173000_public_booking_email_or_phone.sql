create or replace function public.create_public_booking_request(
  p_listing_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_checkin date,
  p_checkout date,
  p_adults integer default 1,
  p_children integer default 0,
  p_babies integer default 0,
  p_message text default ''
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_owner uuid;
  v_apartment text;
  v_site_slug text;
  v_site_enabled boolean;
  v_owner_account_approved boolean;
  v_max_guests integer;
  v_min_notice_days integer := 0;
  v_min_nights integer := 1;
  v_max_nights integer;
  v_contract_end_raw text;
  v_contract_end date;
  v_nights integer;
  v_email text := lower(trim(coalesce(p_guest_email, '')));
  v_phone text := trim(coalesce(p_guest_phone, ''));
  v_request_id uuid;
begin
  if p_checkin is null or p_checkout is null or p_checkout <= p_checkin then
    raise exception 'Dates de séjour invalides';
  end if;
  if length(trim(coalesce(p_guest_name,''))) < 2 then
    raise exception 'Nom valide obligatoire';
  end if;
  if v_email = '' and v_phone = '' then
    raise exception 'Une adresse e-mail ou un numéro de téléphone est obligatoire';
  end if;
  if v_email <> '' and (
    length(v_email) < 5
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'Adresse e-mail invalide';
  end if;
  if v_phone <> '' and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then
    raise exception 'Numéro de téléphone invalide';
  end if;
  if coalesce(p_adults,0) < 1 or coalesce(p_children,0) < 0 or coalesce(p_babies,0) < 0 then
    raise exception 'Nombre de voyageurs invalide';
  end if;

  select l.user_id, l.apartment_id, l.site_slug, s.site_enabled,
         exists (
           select 1 from public.user_profiles up
           where up.user_id = l.user_id
             and up.status = 'approved'
         ),
         l.max_guests, l.min_notice_days, l.min_nights, l.max_nights,
         nullif(a.data->>'contractEndDate','')
    into v_owner, v_apartment, v_site_slug, v_site_enabled,
         v_owner_account_approved, v_max_guests, v_min_notice_days,
         v_min_nights, v_max_nights, v_contract_end_raw
  from public.public_listings l
  join public.public_owner_sites s
    on s.user_id = l.user_id and s.site_slug = l.site_slug
  join public.apartments a
    on a.user_id = l.user_id and a.id = l.apartment_id and a.deleted = false
  where l.id = p_listing_id and l.is_published = true;

  if v_owner is null
     or v_site_enabled is distinct from true
     or v_owner_account_approved is distinct from true then
    raise exception 'Ce logement ne reçoit pas de demandes actuellement';
  end if;

  if v_contract_end_raw is not null then
    if v_contract_end_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'La date de fin du contrat du logement est invalide';
    end if;
    v_contract_end := v_contract_end_raw::date;
    if v_contract_end < (now() at time zone 'America/Guadeloupe')::date
       or p_checkout > v_contract_end then
      raise exception 'Le contrat de gestion de ce logement est terminé ou ne couvre pas les dates demandées';
    end if;
  end if;

  v_min_notice_days := greatest(0, coalesce(v_min_notice_days, 0));
  v_min_nights := greatest(1, coalesce(v_min_nights, 1));
  v_nights := p_checkout - p_checkin;

  if p_checkin < (now() at time zone 'America/Guadeloupe')::date + v_min_notice_days then
    raise exception 'Ce logement doit être réservé au moins % jour(s) avant l’arrivée', v_min_notice_days;
  end if;
  if v_nights < v_min_nights then
    raise exception 'La durée minimale de séjour est de % nuit(s)', v_min_nights;
  end if;
  if v_max_nights is not null and v_nights > v_max_nights then
    raise exception 'La durée maximale de séjour est de % nuit(s)', v_max_nights;
  end if;

  if v_max_guests is not null and v_max_guests > 0
     and (coalesce(p_adults,0) + coalesce(p_children,0) + coalesce(p_babies,0)) > v_max_guests then
    raise exception 'Le nombre total de voyageurs dépasse la capacité maximale de ce logement';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || v_apartment, 0));

  update public.public_booking_requests
     set status = 'expired', updated_at = now()
   where owner_user_id = v_owner
     and apartment_id = v_apartment
     and status = 'pending'
     and expires_at <= now();

  if exists (
    select 1
    from public.bookings b
    where b.user_id = v_owner
      and b.deleted = false
      and b.data->>'apartmentId' = v_apartment
      and b.data->>'status' in ('indisponible','option','arrhes','paye')
      and nullif(b.data->>'checkin','') is not null
      and nullif(b.data->>'checkout','') is not null
      and (b.data->>'checkin')::date < p_checkout
      and (b.data->>'checkout')::date > p_checkin
  ) then
    raise exception 'Ces dates ne sont plus disponibles';
  end if;

  -- Les demandes pending ne constituent pas une réservation et ne bloquent donc pas les dates.
  insert into public.public_booking_requests (
    owner_user_id, listing_id, apartment_id, site_slug,
    guest_name, guest_email, guest_phone, checkin, checkout,
    adults, children, babies, message
  ) values (
    v_owner, p_listing_id, v_apartment, v_site_slug,
    trim(p_guest_name), v_email, v_phone, p_checkin, p_checkout,
    coalesce(p_adults,1), coalesce(p_children,0), coalesce(p_babies,0),
    trim(coalesce(p_message,''))
  )
  returning id into v_request_id;

  return jsonb_build_object('ok', true, 'request_id', v_request_id, 'status', 'pending');
end;
$function$;
