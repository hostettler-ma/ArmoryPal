-- Stores, their weekly Armory schedules, and each user's "My stores" list.

create extension if not exists pg_trgm with schema extensions;

-- True when the current user is an admin. security definer so it can be used
-- inside RLS policies without recursing through profiles' own policies.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create function public.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  city text not null check (char_length(btrim(city)) between 1 and 80),
  region text check (char_length(region) <= 80),
  country text not null check (char_length(btrim(country)) between 1 and 80),
  address text check (char_length(address) <= 200),
  timezone text not null check (public.is_valid_timezone(timezone)),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index stores_name_trgm on public.stores using gin (name extensions.gin_trgm_ops);
create index stores_city_trgm on public.stores using gin (city extensions.gin_trgm_ops);

create table public.store_schedules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  label text not null default 'Armory' check (char_length(btrim(label)) between 1 and 40),
  -- 0 = Sunday … 6 = Saturday (matches JavaScript's Date#getDay).
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index store_schedules_store_id on public.store_schedules (store_id);

create table public.user_stores (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);

create index user_stores_store_id on public.user_stores (store_id);

-- RLS --------------------------------------------------------------------

alter table public.stores enable row level security;
alter table public.store_schedules enable row level security;
alter table public.user_stores enable row level security;

create policy "stores are readable by signed-in users"
  on public.stores for select to authenticated using (true);
create policy "admins manage stores"
  on public.stores for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "schedules are readable by signed-in users"
  on public.store_schedules for select to authenticated using (true);
create policy "admins manage schedules"
  on public.store_schedules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "users see their own store list"
  on public.user_stores for select to authenticated using (user_id = auth.uid());
create policy "users add to their own store list"
  on public.user_stores for insert to authenticated with check (user_id = auth.uid());
create policy "users remove from their own store list"
  on public.user_stores for delete to authenticated using (user_id = auth.uid());

-- Search -----------------------------------------------------------------

-- Matches store name or city by substring or trigram similarity (typos).
-- security invoker (default), so RLS still applies.
create function public.search_stores(q text)
returns setof public.stores
language sql
stable
set search_path = public, extensions
as $$
  select s.*
  from public.stores s
  where coalesce(btrim(q), '') = ''
     or s.name ilike '%' || btrim(q) || '%'
     or s.city ilike '%' || btrim(q) || '%'
     or similarity(s.name, btrim(q)) > 0.3
     or similarity(s.city, btrim(q)) > 0.3
  order by greatest(similarity(s.name, btrim(q)), similarity(s.city, btrim(q))) desc, s.name
  limit 50;
$$;
