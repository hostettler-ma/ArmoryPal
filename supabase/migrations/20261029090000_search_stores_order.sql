-- Store search: best match first (in tiers), then by the store's earliest weekly
-- Armory slot, Monday first. LIKE wildcards in the query now match literally.
--
-- Tiers: 0 exact name/city · 1 name/city (or a word in them) starts with the query
--        · 2 contains the query · 3 typo match (trigram similarity).
-- Within a tier: earliest active slot Mon→Sun, then start time, then name;
-- stores without an active slot last. An empty query lists all stores by weekday.

create or replace function public.search_stores(q text)
returns setof public.stores
language sql
stable
set search_path = public, extensions
as $$
  with input as (
    select btrim(coalesce(q, '')) as term,
           replace(replace(replace(btrim(coalesce(q, '')), '\', '\\'), '%', '\%'), '_', '\_') as pattern
  ),
  ranked as (
    select s.id,
      case
        when i.term = '' then 0
        when lower(s.name) = lower(i.term) or lower(s.city) = lower(i.term) then 0
        when (' ' || s.name) ilike '% ' || i.pattern || '%' or (' ' || s.city) ilike '% ' || i.pattern || '%' then 1
        when s.name ilike '%' || i.pattern || '%' or s.city ilike '%' || i.pattern || '%' then 2
        else 3
      end as tier,
      -- Minutes since Monday 00:00 of the earliest active slot (weekday 0 = Sunday → last).
      (select min(((sc.weekday + 6) % 7) * 1440 + extract(hour from sc.start_time) * 60 + extract(minute from sc.start_time))
       from public.store_schedules sc
       where sc.store_id = s.id and sc.active) as week_minute
    from public.stores s, input i
    where i.term = ''
       or s.name ilike '%' || i.pattern || '%'
       or s.city ilike '%' || i.pattern || '%'
       or similarity(s.name, i.term) > 0.3
       or similarity(s.city, i.term) > 0.3
  )
  -- s.* (not a column list) so new store columns flow through automatically.
  select s.*
  from ranked r
  join public.stores s on s.id = r.id
  order by r.tier, r.week_minute nulls last, s.name
  limit 50;
$$;
