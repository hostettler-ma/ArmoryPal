-- Store owners manage their events: GEM and ticket links, moving one event or
-- the weekly slot, and one-off events outside the weekly schedule.
--
-- Event model changes:
--   * slot_date: the weekly slot an event belongs to. Lazy creation dedupes on
--     (schedule_id, slot_date), so moving an event (event_date/starts_at) never
--     makes a duplicate on the original day.
--   * schedule_id is null for one-off events (and so is slot_date).
--   * label is stored on the event (copied from the schedule for weekly ones).
--   * moved_from: the start time before the first move, for "Moved from …".

-- Columns --------------------------------------------------------------------

alter table public.events
  add column slot_date date,
  add column label text,
  add column moved_from timestamptz,
  add column gem_url text,
  add column gem_code text,
  add column ticket_url text;

update public.events e
set slot_date = e.event_date,
    label = coalesce((select label from public.store_schedules s where s.id = e.schedule_id), 'Armory');

alter table public.events
  alter column schedule_id drop not null,
  alter column label set not null,
  add constraint events_label_check check (char_length(btrim(label)) between 1 and 40),
  add constraint events_slot_check check ((schedule_id is null) = (slot_date is null)),
  drop constraint events_schedule_id_event_date_key,
  add constraint events_schedule_id_slot_date_key unique (schedule_id, slot_date);

create index events_one_off on public.events (store_id, starts_at) where schedule_id is null;

alter table public.stores add column ticket_url text;

-- Links: https only. GEM links must point at fabtcg.com; a GEM event code is
-- a short alphanumeric id. Mirrored by parseEventLinks() in src/lib/event-manage.ts.
create function public.is_https_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url ~ '^https://[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$' and char_length(p_url) <= 300;
$$;

create function public.is_gem_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.is_https_url(p_url) and p_url ~* '^https://([a-z0-9-]+\.)*fabtcg\.com([/?#]|$)';
$$;

alter table public.events
  add constraint events_gem_url_check check (public.is_gem_url(gem_url)),
  add constraint events_gem_code_check check (gem_code ~ '^[A-Za-z0-9-]{1,32}$'),
  add constraint events_ticket_url_check check (public.is_https_url(ticket_url));
alter table public.stores
  add constraint stores_ticket_url_check check (public.is_https_url(ticket_url));

-- Weekly events inserted directly (seed scripts, tests) get their slot and label filled in.
create function public.events_fill_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.schedule_id is not null then
    new.slot_date := coalesce(new.slot_date, new.event_date);
    new.label := coalesce(new.label, (select label from public.store_schedules where id = new.schedule_id));
  end if;
  return new;
end;
$$;

create trigger events_fill_defaults before insert on public.events
  for each row execute function public.events_fill_defaults();

-- Live updates for changes to the event row itself (moved, links).
create function public.broadcast_event_row_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  for v_event_id in select distinct id from new_rows loop
    perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'change', 'event:' || v_event_id, true);
  end loop;
  return null;
end;
$$;

create trigger events_broadcast_upd after update on public.events
  referencing new table as new_rows for each statement execute function public.broadcast_event_row_changes();

-- Notification kind -------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided', 'event_moved'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided', 'event_moved'));

-- Helpers ----------------------------------------------------------------------

-- Start and end (end of the local day) of an event on a store-local date.
create function public.event_times(p_date date, p_start_time time, p_timezone text)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select (p_date + p_start_time) at time zone p_timezone,
         ((p_date + 1)::timestamp) at time zone p_timezone;
$$;

-- "Thu, Nov 12 · 6:30 PM" in the store's time zone, for notification text.
create function public.format_event_time(p_at timestamptz, p_timezone text)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone p_timezone, 'Dy, Mon FMDD · FMHH12:MI AM');
$$;

-- Tells the event's audience (minus the caller) that it moved.
create function public.announce_event_moved(p_event_id uuid, p_from timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  v_tz text;
  v_store text;
  v_payload jsonb;
  v_recipient uuid;
begin
  select * into ev from public.events where id = p_event_id;
  select timezone, name into v_tz, v_store from public.stores where id = ev.store_id;
  if ev.starts_at = p_from then
    return;
  end if;
  v_payload := jsonb_build_object(
    'store', v_store, 'label', ev.label,
    'from', public.format_event_time(p_from, v_tz), 'to', public.format_event_time(ev.starts_at, v_tz));
  for v_recipient in select * from public.event_audience(p_event_id, array[auth.uid()]) loop
    perform public.notify(v_recipient, p_event_id, 'event_moved', v_payload);
  end loop;
end;
$$;

create function public.assert_valid_label(p_label text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 40 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
end;
$$;

create function public.assert_valid_links(p_gem_url text, p_gem_code text, p_ticket_url text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_gem_url is not null and not public.is_gem_url(p_gem_url) then
    raise exception 'invalid_gem_link' using errcode = '22023';
  end if;
  if p_gem_code is not null and p_gem_code !~ '^[A-Za-z0-9-]{1,32}$' then
    raise exception 'invalid_gem_link' using errcode = '22023';
  end if;
  if p_ticket_url is not null and not public.is_https_url(p_ticket_url) then
    raise exception 'invalid_ticket_link' using errcode = '22023';
  end if;
end;
$$;

-- Lazy creation, now slot-based and with one-off events ---------------------------

-- Creates (if needed) and returns the current event of every active slot of the
-- given stores, plus their one-off events in the next 14 days.
-- The current event of a slot is the earliest not-ended event within a week of
-- the slot's current occurrence, so an event moved later stays current until it
-- ends, and one moved earlier hands over to next week's once it's over.
create or replace function public.current_events_for_stores(p_store_ids uuid[])
returns setof public.events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.events (schedule_id, store_id, event_date, slot_date, starts_at, ends_at, label)
  select sch.id, sch.store_id, occ.event_date, occ.event_date, occ.starts_at, occ.ends_at, sch.label
  from public.store_schedules sch
  join public.stores st on st.id = sch.store_id
  cross join lateral public.event_occurrence(sch.weekday, sch.start_time, st.timezone) occ
  where sch.store_id = any (p_store_ids) and sch.active
  on conflict (schedule_id, slot_date) do nothing;

  -- This week's event was moved earlier and is already over: open next week's.
  insert into public.events (schedule_id, store_id, event_date, slot_date, starts_at, ends_at, label)
  select sch.id, sch.store_id, occ.event_date + 7, occ.event_date + 7, t.starts_at, t.ends_at, sch.label
  from public.store_schedules sch
  join public.stores st on st.id = sch.store_id
  cross join lateral public.event_occurrence(sch.weekday, sch.start_time, st.timezone) occ
  cross join lateral public.event_times(occ.event_date + 7, sch.start_time, st.timezone) t
  join public.events e on e.schedule_id = sch.id and e.slot_date = occ.event_date
  where sch.store_id = any (p_store_ids) and sch.active and e.ends_at <= now()
  on conflict (schedule_id, slot_date) do nothing;

  return query
  select c.* from (
    select distinct on (sch.id) e.*
    from public.store_schedules sch
    join public.stores st on st.id = sch.store_id
    cross join lateral public.event_occurrence(sch.weekday, sch.start_time, st.timezone) occ
    join public.events e on e.schedule_id = sch.id
      and e.slot_date between occ.event_date - 7 and occ.event_date + 7
      and e.ends_at > now()
    where sch.store_id = any (p_store_ids) and sch.active
    order by sch.id, e.slot_date
  ) c
  union all
  select e.*
  from public.events e
  join public.stores st on st.id = e.store_id
  where e.store_id = any (p_store_ids) and e.schedule_id is null and st.archived_at is null
    and e.ends_at > now() and e.starts_at < now() + interval '14 days'
  order by starts_at;
end;
$$;

-- Copying requests forward: weekly events of the same slot only, by slot order.
create or replace function public.copy_open_requests(p_from_event uuid, p_to_event uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  from_ev public.events;
  to_ev public.events;
  r record;
  v_count int := 0;
  v_copies int := 0;
  v_first_card text;
  v_recipient uuid;
begin
  to_ev := public.assert_event_open(p_to_event);
  perform public.assert_attending(p_to_event);

  select * into from_ev from public.events where id = p_from_event;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if from_ev.schedule_id is null or to_ev.schedule_id is null
     or from_ev.schedule_id <> to_ev.schedule_id or from_ev.ends_at > now()
     or from_ev.slot_date >= to_ev.slot_date then
    raise exception 'invalid_copy' using errcode = 'P0001';
  end if;

  for r in
    select req.id, req.card_id, req.note,
           req.quantity - coalesce((select sum(quantity) from public.pledges where request_id = req.id), 0) as remaining
    from public.requests req
    where req.event_id = p_from_event and req.requester_id = auth.uid() and req.status = 'active'
      and not exists (select 1 from public.requests c where c.event_id = p_to_event and c.copied_from_id = req.id)
    order by req.created_at
  loop
    continue when r.remaining <= 0;

    insert into public.requests as t (event_id, requester_id, card_id, quantity, note, copied_from_id)
    values (p_to_event, auth.uid(), r.card_id, r.remaining, r.note, r.id)
    on conflict (event_id, requester_id, card_id) where status = 'active'
    do update set
      quantity = least(t.quantity + excluded.quantity, 20),
      copied_from_id = coalesce(t.copied_from_id, excluded.copied_from_id),
      updated_at = now();

    v_count := v_count + 1;
    v_copies := v_copies + r.remaining;
    v_first_card := coalesce(v_first_card, public.card_label(r.card_id));
  end loop;

  if v_count > 0 then
    for v_recipient in select * from public.new_request_recipients(p_to_event) loop
      perform public.notify(v_recipient, p_to_event, 'new_requests', jsonb_build_object(
        'actor', public.my_display_name(), 'card', v_first_card, 'items', v_count, 'copies', v_copies));
    end loop;
  end if;

  return v_count;
end;
$$;

-- Owner RPCs ---------------------------------------------------------------------

-- Creates the next p_weeks weekly events of every active slot (so owners can
-- prepare or move future weeks) and returns all of the store's upcoming events.
create function public.owner_upcoming_events(p_store_id uuid, p_weeks int default 6)
returns setof public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_weeks int := least(greatest(coalesce(p_weeks, 6), 1), 8);
begin
  perform public.assert_can_manage(p_store_id);

  insert into public.events (schedule_id, store_id, event_date, slot_date, starts_at, ends_at, label)
  select sch.id, sch.store_id, occ.event_date + 7 * w, occ.event_date + 7 * w, t.starts_at, t.ends_at, sch.label
  from public.store_schedules sch
  join public.stores st on st.id = sch.store_id
  cross join lateral public.event_occurrence(sch.weekday, sch.start_time, st.timezone) occ
  cross join generate_series(0, v_weeks - 1) w
  cross join lateral public.event_times(occ.event_date + 7 * w, sch.start_time, st.timezone) t
  where sch.store_id = p_store_id and sch.active and st.archived_at is null
  on conflict (schedule_id, slot_date) do nothing;

  return query
  select e.*
  from public.events e
  left join public.store_schedules sch on sch.id = e.schedule_id
  where e.store_id = p_store_id and e.ends_at > now()
    and (e.schedule_id is null or sch.active)
  order by e.starts_at;
end;
$$;

create function public.owner_update_event_links(
  p_event_id uuid, p_gem_url text, p_gem_code text, p_ticket_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
  v_gem_url text := nullif(btrim(coalesce(p_gem_url, '')), '');
  v_gem_code text := nullif(btrim(coalesce(p_gem_code, '')), '');
  v_ticket_url text := nullif(btrim(coalesce(p_ticket_url, '')), '');
begin
  perform public.assert_can_manage(ev.store_id);
  perform public.assert_valid_links(v_gem_url, v_gem_code, v_ticket_url);
  update public.events set gem_url = v_gem_url, gem_code = v_gem_code, ticket_url = v_ticket_url
  where id = p_event_id;
end;
$$;

-- Moves one event to another store-local date and time. Weekly events stay
-- within a week of their slot so they never overlap the next or previous week.
create function public.owner_move_event(p_event_id uuid, p_date date, p_start_time time)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
  v_tz text;
  t record;
begin
  perform public.assert_can_manage(ev.store_id);
  select timezone into v_tz from public.stores where id = ev.store_id;
  select * into t from public.event_times(p_date, p_start_time, v_tz);

  if t.starts_at <= now() then
    raise exception 'move_in_past' using errcode = 'P0001';
  end if;
  if ev.schedule_id is not null and (p_date >= ev.slot_date + 7 or p_date <= ev.slot_date - 7) then
    raise exception 'move_too_far' using errcode = 'P0001';
  end if;
  if ev.schedule_id is null and p_date > (now() at time zone v_tz)::date + 90 then
    raise exception 'too_far_ahead' using errcode = 'P0001';
  end if;

  update public.events
  set event_date = p_date, starts_at = t.starts_at, ends_at = t.ends_at,
      -- Remember the original time; moving back there clears the "moved" note.
      moved_from = case when coalesce(moved_from, ev.starts_at) = t.starts_at then null
                        else coalesce(moved_from, ev.starts_at) end
  where id = p_event_id;

  perform public.announce_event_moved(p_event_id, ev.starts_at);
end;
$$;

-- A one-off event outside the weekly schedule. Returns its id.
create function public.owner_create_event(
  p_store_id uuid, p_label text, p_date date, p_start_time time,
  p_gem_url text default null, p_gem_code text default null, p_ticket_url text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.stores;
  t record;
  v_id uuid;
  v_gem_url text := nullif(btrim(coalesce(p_gem_url, '')), '');
  v_gem_code text := nullif(btrim(coalesce(p_gem_code, '')), '');
  v_ticket_url text := nullif(btrim(coalesce(p_ticket_url, '')), '');
begin
  perform public.assert_can_manage(p_store_id);
  select * into st from public.stores where id = p_store_id;
  if not found or st.archived_at is not null then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_valid_label(p_label);
  perform public.assert_valid_links(v_gem_url, v_gem_code, v_ticket_url);
  select * into t from public.event_times(p_date, p_start_time, st.timezone);
  if t.ends_at <= now() then
    raise exception 'date_in_past' using errcode = 'P0001';
  end if;
  if p_date > (now() at time zone st.timezone)::date + 90 then
    raise exception 'too_far_ahead' using errcode = 'P0001';
  end if;

  insert into public.events (schedule_id, store_id, event_date, starts_at, ends_at, label, gem_url, gem_code, ticket_url)
  values (null, p_store_id, p_date, t.starts_at, t.ends_at, btrim(p_label), v_gem_url, v_gem_code, v_ticket_url)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.owner_add_schedule(p_store_id uuid, p_label text, p_weekday smallint, p_start_time time)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.assert_can_manage(p_store_id);
  perform public.assert_valid_label(p_label);
  if p_weekday not between 0 and 6 or p_start_time is null then
    raise exception 'invalid_schedule' using errcode = '22023';
  end if;
  if exists (select 1 from public.stores where id = p_store_id and archived_at is not null) then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;
  insert into public.store_schedules (store_id, label, weekday, start_time)
  values (p_store_id, btrim(p_label), p_weekday, p_start_time)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.owner_set_schedule_active(p_schedule_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sch public.store_schedules;
begin
  select * into sch from public.store_schedules where id = p_schedule_id;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_can_manage(sch.store_id);
  update public.store_schedules set active = p_active where id = p_schedule_id;
end;
$$;

-- Changes a weekly slot ("move all events"). Open events of the slot follow:
-- every open event's slot shifts by the same number of days (to the new
-- weekday's occurrence this week), and events that weren't moved one by one
-- also take the new date and time. Moved events keep their own date and time.
-- Everyone following a re-timed event is notified.
create function public.owner_update_schedule(
  p_schedule_id uuid, p_label text, p_weekday smallint, p_start_time time)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sch public.store_schedules;
  v_tz text;
  v_shift int;
  e record;
  t record;
begin
  select * into sch from public.store_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_can_manage(sch.store_id);
  perform public.assert_valid_label(p_label);
  if p_weekday not between 0 and 6 or p_start_time is null then
    raise exception 'invalid_schedule' using errcode = '22023';
  end if;
  select timezone into v_tz from public.stores where id = sch.store_id;

  -- Days from the old weekday's current occurrence to the new one's (-6..6).
  select (n.event_date - o.event_date) into v_shift
  from public.event_occurrence(sch.weekday, sch.start_time, v_tz) o,
       public.event_occurrence(p_weekday, p_start_time, v_tz) n;

  update public.store_schedules
  set label = btrim(p_label), weekday = p_weekday, start_time = p_start_time
  where id = p_schedule_id;

  for e in
    select * from public.events
    where schedule_id = p_schedule_id and ends_at > now()
    order by slot_date
    for update
  loop
    if e.moved_from is null then
      select * into t from public.event_times(e.slot_date + v_shift, p_start_time, v_tz);
      update public.events
      set slot_date = e.slot_date + v_shift, event_date = e.slot_date + v_shift,
          starts_at = t.starts_at, ends_at = t.ends_at, label = btrim(p_label)
      where id = e.id;
      perform public.announce_event_moved(e.id, e.starts_at);
    else
      update public.events set slot_date = e.slot_date + v_shift, label = btrim(p_label) where id = e.id;
    end if;
  end loop;
end;
$$;

-- Store-wide info owners may edit: notes and the default ticket link.
create function public.owner_update_store_info(p_store_id uuid, p_notes text, p_ticket_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_ticket_url text := nullif(btrim(coalesce(p_ticket_url, '')), '');
begin
  perform public.assert_can_manage(p_store_id);
  if char_length(v_notes) > 500 then
    raise exception 'notes_too_long' using errcode = '22023';
  end if;
  perform public.assert_valid_links(null, null, v_ticket_url);
  update public.stores set notes = v_notes, ticket_url = v_ticket_url where id = p_store_id;
end;
$$;

-- Grants (see *_explicit_api_grants.sql). Replaced functions keep theirs. -----------

revoke execute on function
  public.is_https_url(text),
  public.is_gem_url(text),
  public.events_fill_defaults(),
  public.broadcast_event_row_changes(),
  public.event_times(date, time, text),
  public.format_event_time(timestamptz, text),
  public.announce_event_moved(uuid, timestamptz),
  public.assert_valid_label(text),
  public.assert_valid_links(text, text, text),
  public.owner_upcoming_events(uuid, int),
  public.owner_update_event_links(uuid, text, text, text),
  public.owner_move_event(uuid, date, time),
  public.owner_create_event(uuid, text, date, time, text, text, text),
  public.owner_add_schedule(uuid, text, smallint, time),
  public.owner_set_schedule_active(uuid, boolean),
  public.owner_update_schedule(uuid, text, smallint, time),
  public.owner_update_store_info(uuid, text, text)
from public, anon;

-- Internal helpers: not callable through the API. (is_https_url/is_gem_url are
-- used by check constraints, which run as the writing role, so they stay.)
revoke execute on function
  public.events_fill_defaults(),
  public.broadcast_event_row_changes(),
  public.event_times(date, time, text),
  public.format_event_time(timestamptz, text),
  public.announce_event_moved(uuid, timestamptz),
  public.assert_valid_label(text),
  public.assert_valid_links(text, text, text)
from authenticated;

grant execute on function
  public.is_https_url(text),
  public.is_gem_url(text),
  public.owner_upcoming_events(uuid, int),
  public.owner_update_event_links(uuid, text, text, text),
  public.owner_move_event(uuid, date, time),
  public.owner_create_event(uuid, text, date, time, text, text, text),
  public.owner_add_schedule(uuid, text, smallint, time),
  public.owner_set_schedule_active(uuid, boolean),
  public.owner_update_schedule(uuid, text, smallint, time),
  public.owner_update_store_info(uuid, text, text)
to authenticated;

grant execute on function
  public.is_https_url(text),
  public.is_gem_url(text),
  public.events_fill_defaults(),
  public.broadcast_event_row_changes(),
  public.event_times(date, time, text),
  public.format_event_time(timestamptz, text),
  public.announce_event_moved(uuid, timestamptz),
  public.assert_valid_label(text),
  public.assert_valid_links(text, text, text),
  public.owner_upcoming_events(uuid, int),
  public.owner_update_event_links(uuid, text, text, text),
  public.owner_move_event(uuid, date, time),
  public.owner_create_event(uuid, text, date, time, text, text, text),
  public.owner_add_schedule(uuid, text, smallint, time),
  public.owner_set_schedule_active(uuid, boolean),
  public.owner_update_schedule(uuid, text, smallint, time),
  public.owner_update_store_info(uuid, text, text)
to service_role;
