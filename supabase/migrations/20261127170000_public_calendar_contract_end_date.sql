create or replace view public.public_listings_public as
select l.id,l.title,l.summary,l.description,l.location,l.property_type,l.max_guests,l.bedroom_count,l.bathroom_count,l.price_from,l.currency,l.photo_urls,l.amenities,l.site_slug,l.display_order,l.price_to,l.min_notice_days,l.min_nights,l.max_nights,
       nullif(a.data->>'contractEndDate','') as contract_end_date
from public.public_listings l
join public.public_owner_sites s on s.user_id=l.user_id and s.site_slug=l.site_slug
join public.apartments a on a.user_id=l.user_id and a.id=l.apartment_id
where l.is_published=true and s.site_enabled=true and a.deleted=false
and case
 when nullif(a.data->>'contractEndDate','') is null then true
 when (a.data->>'contractEndDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (a.data->>'contractEndDate')::date >= (now() at time zone 'America/Guadeloupe')::date
 else false
end;
