-- Weekly event instances (one per schedule per week, created lazily) and attendance.

-- When is the "current" occurrence of a weekly slot? The event on the next
-- occurrence of `weekday` in the store's local time, counting today until the
-- local day ends. The event stays current (and writable) until the end of its
-- local day; ends_at marks that. Mirrored in src/lib/events.ts (currentEventFor).
create function public.event_occurrence(
  p_weekday smallint,
  p_start_time time,
  p_timezone text,
  p_now timestamptz default now()
)
returns table (event_date date, starts_at timestamptz, ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with local_today as (
    select (p_now at time zone p_timezone)::date as d
  ),
  occurrence as (
    select d + ((p_weekday - extract(dow from d)::int + 7) % 7) as event_date
    from local_today
  )
  select
    o.event_date,
    (o.event_date + p_start_time) at time zone p_timezone,
    ((o.event_date + 1)::timestamp) at time zone p_timezone
  from occurrence o;
$$;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.store_schedules (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  event_date date not null, -- local to the store
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (schedule_id, event_date),
  check (ends_at > starts_at)
);

create index events_store_id on public.events (store_id, event_date desc);

create table public.attendances (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index attendances_user_id on public.attendances (user_id);

alter table public.events enable row level security;
alter table public.attendances enable row level security;

-- Readable by signed-in users; all writes go through the functions below.
create policy "events are readable by signed-in users"
  on public.events for select to authenticated using (true);
create policy "attendances are readable by signed-in users"
  on public.attendances for select to authenticated using (true);

-- Creates (if needed) and returns the current event for every active schedule
-- of the given stores. Idempotent; safe to call on every page view.
create function public.current_events_for_stores(p_store_ids uuid[])
returns setof public.events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.events (schedule_id, store_id, event_date, starts_at, ends_at)
  select sch.id, sch.store_id, occ.event_date, occ.starts_at, occ.ends_at
  from public.store_schedules sch
  join public.stores st on st.id = sch.store_id
  cross join lateral public.event_occurrence(sch.weekday, sch.start_time, st.timezone) occ
  where sch.store_id = any (p_store_ids) and sch.active
  on conflict (schedule_id, event_date) do nothing;

  return query
  select e.*
  from public.events e
  join public.store_schedules sch on sch.id = e.schedule_id
  join public.stores st on st.id = sch.store_id
  cross join lateral public.event_occurrence(sch.weekday, sch.start_time, st.timezone) occ
  where sch.store_id = any (p_store_ids) and sch.active and e.event_date = occ.event_date
  order by e.starts_at;
end;
$$;

-- Raises unless the event exists and hasn't ended. Returns the event.
create function public.assert_event_open(p_event_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = p_event_id;
  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if now() >= ev.ends_at then
    raise exception 'this event has ended' using errcode = 'P0001', hint = 'event_ended';
  end if;
  return ev;
end;
$$;

create function public.attend_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_event_open(p_event_id);
  insert into public.attendances (event_id, user_id)
  values (p_event_id, auth.uid())
  on conflict do nothing;
end;
$$;

-- Phase 5 extends this with options to cancel the user's requests and pledges.
create function public.leave_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_event_open(p_event_id);
  delete from public.attendances where event_id = p_event_id and user_id = auth.uid();
end;
$$;

-- Internal helper; not part of the API.
revoke execute on function public.assert_event_open(uuid) from public, anon, authenticated;
revoke execute on function public.current_events_for_stores(uuid[]) from public, anon;
revoke execute on function public.attend_event(uuid) from public, anon;
revoke execute on function public.leave_event(uuid) from public, anon;
