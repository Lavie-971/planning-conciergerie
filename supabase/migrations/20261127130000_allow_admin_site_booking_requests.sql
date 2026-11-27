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
  v_site_accepted boolean;
  v_owner_is_admin boolean;
  v_max_guests integer;
  v_request_id uuid;
begin
  if p_checkin is null or p_checkout is null or p_checkout <= p_checkin then
    raise exception 'Dates de séjour invalides';
  end if;
  if length(trim(coalesce(p_guest_name,''))) < 2
     or length(trim(coalesce(p_guest_email,''))) < 5
     or position('@' in p_guest_email) = 0 then
    raise exception 'Nom et adresse e-mail valides obligatoires';
  end if;
  if coalesce(p_adults,0) < 1 or coalesce(p_children,0) < 0 or coalesce(p_babies,0) < 0 then
    raise exception 'Nombre de voyageurs invalide';
  end if;

  select l.user_id, l.apartment_id, l.site_slug, s.site_enabled,
         (s.site_review_status = 'approved'
          or (s.site_review_status = 'draft'
              and coalesce(s.site_review_note,'') like '%Création acceptée par l’administrateur%')),
         exists (
           select 1 from public.user_profiles up
           where up.user_id = l.user_id
             and up.role = 'admin'
             and up.status = 'approved'
         ),
         l.max_guests
    into v_owner, v_apartment, v_site_slug, v_site_enabled,
         v_site_accepted, v_owner_is_admin, v_max_guests
  from public.public_listings l
  join public.public_owner_sites s
    on s.user_id = l.user_id and s.site_slug = l.site_slug
  join public.apartments a
    on a.user_id = l.user_id and a.id = l.apartment_id and a.deleted = false
  where l.id = p_listing_id
    and l.is_published = true;

  if v_owner is null or v_site_enabled is distinct from true
     or (v_site_accepted is distinct from true and v_owner_is_admin is distinct from true) then
    raise exception 'Ce logement ne reçoit pas de demandes actuellement';
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

  if exists (
    select 1
    from public.public_booking_requests r
    where r.owner_user_id = v_owner
      and r.apartment_id = v_apartment
      and r.status = 'pending'
      and r.expires_at > now()
      and r.checkin < p_checkout
      and r.checkout > p_checkin
  ) then
    raise exception 'Une demande est déjà en attente sur tout ou partie de ces dates';
  end if;

  insert into public.public_booking_requests (
    owner_user_id, listing_id, apartment_id, site_slug,
    guest_name, guest_email, guest_phone, checkin, checkout,
    adults, children, babies, message
  ) values (
    v_owner, p_listing_id, v_apartment, v_site_slug,
    trim(p_guest_name), lower(trim(p_guest_email)), trim(coalesce(p_guest_phone,'')),
    p_checkin, p_checkout, coalesce(p_adults,1), coalesce(p_children,0),
    coalesce(p_babies,0), trim(coalesce(p_message,''))
  )
  returning id into v_request_id;

  return jsonb_build_object('ok', true, 'request_id', v_request_id, 'status', 'pending');
end;
$function$;
