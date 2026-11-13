-- Owners and admins cancel or delete an event.
--
--   * Cancel: the event stays visible with a "Cancelled" note ("Closed for
--     Thanksgiving") and becomes read-only. Its audience (everyone going or
--     with the store in My stores) gets an `event_cancelled` notification.
--   * Delete: removes the event and everything on it, silently. One-off events
--     are deleted outright. A weekly event keeps a hidden marker row
--     (`deleted_at`), because lazy creation would otherwise recreate the slot's
--     event on the next page view. The marker is invisible everywhere (RLS and
--     the event RPCs), and the slot hands over to next week's event.

-- Columns --------------------------------------------------------------------

alter table public.events
  add column cancelled_at timestamptz,
  add column cancel_note text,
  add column deleted_at timestamptz,
  add constraint events_cancel_note_check check (
    cancel_note is null or (cancelled_at is not null and char_length(cancel_note) between 1 and 140));

-- Deleted markers are invisible to the API.
drop policy "events are readable by signed-in users" on public.events;
create policy "events are readable by signed-in users"
  on public.events for select to authenticated using (deleted_at is null);

-- Notification kind ------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided', 'event_moved', 'attendee_left',
                  'format_poll_opened', 'format_confirmed', 'event_cancelled'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided', 'event_moved', 'attendee_left',
                  'format_poll_opened', 'format_confirmed', 'event_cancelled'));

-- Every event write RPC calls this: deleted events don't exist, cancelled
-- ones are read-only (like ended ones).
create or replace function public.assert_event_open(p_event_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  if public.is_banned() then
    raise exception 'banned' using errcode = '42501';
  end if;
  select * into ev from public.events where id = p_event_id and deleted_at is null;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if now() >= ev.ends_at then
    raise exception 'event_ended' using errcode = 'P0001';
  end if;
  if ev.cancelled_at is not null then
    raise exception 'event_cancelled' using errcode = 'P0001';
  end if;
  return ev;
end;
$$;

-- Moving the weekly slot doesn't announce cancelled or deleted events.
create or replace function public.announce_event_moved(p_event_id uuid, p_from timestamptz)
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
  if ev.starts_at = p_from or ev.cancelled_at is not null or ev.deleted_at is not null then
    return;
  end if;
  select timezone, name into v_tz, v_store from public.stores where id = ev.store_id;
  v_payload := jsonb_build_object(
    'store', v_store, 'label', ev.label,
    'from', public.format_event_time(p_from, v_tz), 'to', public.format_event_time(ev.starts_at, v_tz));
  for v_recipient in select * from public.event_audience(p_event_id, array[auth.uid()]) loop
    perform public.notify(v_recipient, p_event_id, 'event_moved', v_payload);
  end loop;
end;
$$;

-- Lazy creation: same as *_event_management.sql, but a deleted event hands its
-- slot over to next week's (like one moved earlier that's over) and is never returned.
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

  -- This week's event is over early (moved earlier) or deleted: open next week's.
  insert into public.events (schedule_id, store_id, event_date, slot_date, starts_at, ends_at, label)
  select sch.id, sch.store_id, occ.event_date + 7, occ.event_date + 7, t.starts_at, t.ends_at, sch.label
  from public.store_schedules sch
  join public.stores st on st.id = sch.store_id
  cross join lateral public.event_occurrence(sch.weekday, sch.start_time, st.timezone) occ
  cross join lateral public.event_times(occ.event_date + 7, sch.start_time, st.timezone) t
  join public.events e on e.schedule_id = sch.id and e.slot_date = occ.event_date
  where sch.store_id = any (p_store_ids) and sch.active and (e.ends_at <= now() or e.deleted_at is not null)
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
      and e.deleted_at is null
    where sch.store_id = any (p_store_ids) and sch.active
    order by sch.id, e.slot_date
  ) c
  union all
  select e.*
  from public.events e
  join public.stores st on st.id = e.store_id
  where e.store_id = any (p_store_ids) and e.schedule_id is null and st.archived_at is null
    and e.deleted_at is null
    and e.ends_at > now() and e.starts_at < now() + interval '14 days'
  order by starts_at;
end;
$$;

-- Same as *_event_management.sql, without deleted markers.
create or replace function public.owner_upcoming_events(p_store_id uuid, p_weeks int default 6)
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
  where e.store_id = p_store_id and e.ends_at > now() and e.deleted_at is null
    and (e.schedule_id is null or sch.active)
  order by e.starts_at;
end;
$$;

-- Owner RPCs ---------------------------------------------------------------------

-- Cancels an open event with an optional note for players. Attendance,
-- requests and pledges stay as they were; the event just becomes read-only.
create function public.owner_cancel_event(p_event_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_tz text;
  v_store text;
  v_payload jsonb;
  v_recipient uuid;
begin
  perform public.assert_can_manage(ev.store_id);
  if char_length(v_note) > 140 then
    raise exception 'cancel_note_too_long' using errcode = '22023';
  end if;

  update public.events set cancelled_at = now(), cancel_note = v_note where id = p_event_id;

  select timezone, name into v_tz, v_store from public.stores where id = ev.store_id;
  v_payload := jsonb_build_object(
    'store', v_store, 'label', ev.label, 'when', public.format_event_time(ev.starts_at, v_tz));
  if v_note is not null then
    v_payload := v_payload || jsonb_build_object('note', v_note);
  end if;
  for v_recipient in select * from public.event_audience(p_event_id, array[auth.uid()]) loop
    perform public.notify(v_recipient, p_event_id, 'event_cancelled', v_payload);
  end loop;
end;
$$;

-- Deletes an event that hasn't ended (cancelled or not), with its attendance,
-- requests, pledges, poll and notifications. Nobody is notified.
create function public.owner_delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  if public.is_banned() then
    raise exception 'banned' using errcode = '42501';
  end if;
  select * into ev from public.events where id = p_event_id and deleted_at is null for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_can_manage(ev.store_id);
  -- Past events stay in the store's history.
  if now() >= ev.ends_at then
    raise exception 'event_ended' using errcode = 'P0001';
  end if;

  if ev.schedule_id is null then
    delete from public.events where id = p_event_id; -- everything on it cascades
    return;
  end if;

  -- Weekly: clear the event, keep a hidden marker so the slot isn't recreated.
  delete from public.notifications where event_id = p_event_id;
  delete from public.format_polls where event_id = p_event_id;
  delete from public.pledges where event_id = p_event_id;
  delete from public.requests where event_id = p_event_id;
  delete from public.attendances where event_id = p_event_id;
  update public.events
  set deleted_at = now(), cancelled_at = null, cancel_note = null,
      gem_url = null, gem_code = null, ticket_url = null, format = null
  where id = p_event_id;
end;
$$;

-- Grants (see *_explicit_api_grants.sql). Replaced functions keep theirs. -----------

revoke execute on function
  public.owner_cancel_event(uuid, text),
  public.owner_delete_event(uuid)
from public, anon;

grant execute on function
  public.owner_cancel_event(uuid, text),
  public.owner_delete_event(uuid)
to authenticated, service_role;
