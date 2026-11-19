-- Internal user-ID variants of the shared event logic.
--
-- ArmoryBot's RPCs run as service_role, where auth.uid() is null. Each piece of
-- logic that read auth.uid() now has an internal variant that takes the user
-- explicitly, and the public RPCs became thin wrappers over it. The public
-- RPCs' signatures and behaviour are unchanged; the existing DB tests are the
-- regression net. See docs/armorybot.md §4.3.
--
-- leave_event and remove_from_event now share leave_event_as(), so the rules
-- for "this player is off the event" live in one place.

-- Bans and display names -----------------------------------------------------------

create function public.is_user_banned(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.bans where user_id = p_user_id);
$$;

-- Same as before; RLS policies call this.
create or replace function public.is_banned()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_user_banned(auth.uid());
$$;

create function public.display_name_of(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(display_name, 'Someone') from public.profiles where id = p_user_id;
$$;

create or replace function public.my_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.display_name_of(auth.uid());
$$;

-- Admin rights and store management for a given user --------------------------------

create function public.can_user_manage_store(p_user_id uuid, p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where id = p_user_id), false)
      or (exists (select 1 from public.store_owners where store_id = p_store_id and user_id = p_user_id)
          and not public.is_user_banned(p_user_id));
$$;

-- Event checks -----------------------------------------------------------------------

-- Every event write calls this: deleted events don't exist, ended and
-- cancelled ones are read-only, banned players can't write.
create function public.assert_event_open_for(p_event_id uuid, p_user_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  if public.is_user_banned(p_user_id) then
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

create or replace function public.assert_event_open(p_event_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.assert_event_open_for(p_event_id, auth.uid());
end;
$$;

-- Releasing pledges and cancelling requests -------------------------------------------

-- Releases all of a user's pledges on an event: tells each requester
-- ('pledge_released'), then announces the freed cards ('card_needed_again').
create function public.release_pledges(p_event_id uuid, p_user_id uuid, p_actor text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_released jsonb := public.pledges_to_release(p_event_id, p_user_id);
begin
  for p in
    select pl.id, pl.quantity, r.requester_id, r.card_id
    from public.pledges pl join public.requests r on r.id = pl.request_id
    where pl.event_id = p_event_id and pl.pledger_id = p_user_id
  loop
    perform public.notify(p.requester_id, p_event_id, 'pledge_released', jsonb_build_object(
      'card', public.card_label(p.card_id), 'quantity', p.quantity,
      'actor', p_actor, 'reason', p_reason));
    delete from public.pledges where id = p.id;
  end loop;
  perform public.announce_needed_again(p_event_id, p_user_id, p_actor, p_reason, v_released);
end;
$$;

create or replace function public.release_my_pledges(p_event_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.release_pledges(p_event_id, auth.uid(), public.my_display_name(), p_reason);
end;
$$;

-- Cancels one request: tells each pledger, removes the pledges.
create function public.cancel_request_internal(p_request_id uuid, p_reason text, p_actor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  p record;
begin
  select * into req from public.requests where id = p_request_id;
  for p in select id, pledger_id, quantity from public.pledges where request_id = p_request_id loop
    perform public.notify(p.pledger_id, req.event_id, 'request_cancelled', jsonb_build_object(
      'card', public.card_label(req.card_id), 'quantity', p.quantity,
      'actor', p_actor, 'reason', p_reason));
    delete from public.pledges where id = p.id;
  end loop;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_request_id;
end;
$$;

-- The two-argument form stays for cancel_request (the caller is the actor).
create or replace function public.cancel_request_internal(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.cancel_request_internal(p_request_id, p_reason, public.my_display_name());
end;
$$;

-- Attending and leaving ------------------------------------------------------------------

create function public.attend_event_as(p_event_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform public.assert_event_open_for(p_event_id, p_user_id);
  insert into public.attendances (event_id, user_id)
  values (p_event_id, p_user_id)
  on conflict do nothing;
end;
$$;

create or replace function public.attend_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.attend_event_as(p_event_id, auth.uid());
end;
$$;

-- Takes a player off an event: releases their pledges (always), cancels their
-- active requests (optional), drops their attendance, and, when they left on
-- their own (p_notify_owners), tells the store's owners. Callers check that
-- the event is open. Lock order: pledges, then the player's requests by id,
-- then the attendance (the same as pledge()).
create function public.leave_event_as(
  p_event_id uuid, p_user_id uuid, p_cancel_requests boolean, p_reason text, p_notify_owners boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  ev public.events;
  v_actor text := coalesce(public.display_name_of(p_user_id), 'Someone');
  v_owner uuid;
begin
  select * into ev from public.events where id = p_event_id;
  perform public.release_pledges(p_event_id, p_user_id, v_actor, p_reason);
  if p_cancel_requests then
    for r in
      select id from public.requests
      where event_id = p_event_id and requester_id = p_user_id and status = 'active'
      order by id
      for update
    loop
      perform public.cancel_request_internal(r.id, p_reason, v_actor);
    end loop;
  end if;
  delete from public.attendances where event_id = p_event_id and user_id = p_user_id;

  if found and p_notify_owners then
    for v_owner in
      select user_id from public.store_owners where store_id = ev.store_id and user_id <> p_user_id
    loop
      perform public.notify(v_owner, p_event_id, 'attendee_left', jsonb_build_object(
        'actor', v_actor, 'label', ev.label,
        'when', public.format_event_time(ev.starts_at, (select timezone from public.stores where id = ev.store_id))));
    end loop;
  end if;
end;
$$;

create or replace function public.leave_event(p_event_id uuid, p_cancel_requests boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform public.assert_event_open(p_event_id);
  perform public.leave_event_as(p_event_id, auth.uid(), p_cancel_requests, 'left_event', true);
end;
$$;

-- Admin removal and bans: like leaving with "cancel my requests", reason
-- 'removed', and no owner notification.
create or replace function public.remove_from_event(p_event_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.leave_event_as(p_event_id, p_user_id, true, 'removed', false);
end;
$$;

-- Lazy event creation ---------------------------------------------------------------

-- The inserts of current_events_for_stores, without the sign-in check, so
-- ArmoryBot's worker can make sure this week's events exist.
create function public.ensure_current_events(p_store_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
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
$$;

-- Same as *_cancel_delete_events.sql, with the inserts moved to ensure_current_events().
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

  perform public.ensure_current_events(p_store_ids);

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

-- Grants (see *_explicit_api_grants.sql). Replaced functions keep theirs. --------------
-- All new functions are internal: service_role only.

revoke execute on function
  public.is_user_banned(uuid),
  public.display_name_of(uuid),
  public.can_user_manage_store(uuid, uuid),
  public.assert_event_open_for(uuid, uuid),
  public.release_pledges(uuid, uuid, text, text),
  public.cancel_request_internal(uuid, text, text),
  public.attend_event_as(uuid, uuid),
  public.leave_event_as(uuid, uuid, boolean, text, boolean),
  public.ensure_current_events(uuid[])
from public, anon, authenticated;

grant execute on function
  public.is_user_banned(uuid),
  public.display_name_of(uuid),
  public.can_user_manage_store(uuid, uuid),
  public.assert_event_open_for(uuid, uuid),
  public.release_pledges(uuid, uuid, text, text),
  public.cancel_request_internal(uuid, text, text),
  public.attend_event_as(uuid, uuid),
  public.leave_event_as(uuid, uuid, boolean, text, boolean),
  public.ensure_current_events(uuid[])
to service_role;
