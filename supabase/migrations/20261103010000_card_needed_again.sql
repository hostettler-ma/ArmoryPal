-- 'card_needed_again': when someone un-pledges, leaves, or is removed, the
-- cards they were bringing are needed again. Tell the same audience as
-- 'new_requests' (attendees plus players who saved the store), so someone else
-- can step in. One notification per release, however many cards it frees.
-- The requesters already get 'pledge_released', so they and the releaser are
-- skipped.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event', 'card_needed_again'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event', 'card_needed_again'));

-- Helpers ------------------------------------------------------------------

-- Everyone who follows an event: its attendees plus everyone who saved its
-- store, minus banned players and p_exclude. Internal helper.
create function public.event_audience(p_event_id uuid, p_exclude uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id from public.attendances a where a.event_id = p_event_id
  union
  select us.user_id
  from public.events e
  join public.user_stores us on us.store_id = e.store_id
  where e.id = p_event_id
  except
  select b.user_id from public.bans b
  except
  select unnest(p_exclude);
$$;

create or replace function public.new_request_recipients(p_event_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.event_audience(p_event_id, array[auth.uid()]);
$$;

-- Sends one 'card_needed_again' for a batch of released pledges, given as a
-- jsonb array of {requester_id, card_id, quantity}, in display order. Does
-- nothing for an empty batch. Internal helper.
create function public.announce_needed_again(
  p_event_id uuid, p_releaser uuid, p_actor text, p_reason text, p_released jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_exclude uuid[];
  v_recipient uuid;
begin
  if p_released is null or jsonb_array_length(p_released) = 0 then
    return;
  end if;

  v_payload := jsonb_build_object(
    'actor', p_actor,
    'reason', p_reason,
    'card', public.card_label(p_released -> 0 ->> 'card_id'),
    'items', jsonb_array_length(p_released),
    'copies', (select sum((x ->> 'quantity')::int) from jsonb_array_elements(p_released) x));
  v_exclude := array(select (x ->> 'requester_id')::uuid from jsonb_array_elements(p_released) x)
    || p_releaser;

  for v_recipient in select * from public.event_audience(p_event_id, v_exclude) loop
    perform public.notify(v_recipient, p_event_id, 'card_needed_again', v_payload);
  end loop;
end;
$$;

-- Released pledges as announce_needed_again() expects them, oldest first.
create function public.pledges_to_release(p_event_id uuid, p_pledger_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'requester_id', r.requester_id, 'card_id', r.card_id, 'quantity', pl.quantity)
    order by pl.created_at, pl.id), '[]'::jsonb)
  from public.pledges pl join public.requests r on r.id = pl.request_id
  where pl.event_id = p_event_id and pl.pledger_id = p_pledger_id;
$$;

-- Release paths, now also announcing ---------------------------------------

-- Same as before, plus the announcement.
create or replace function public.release_my_pledges(p_event_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_released jsonb := public.pledges_to_release(p_event_id, auth.uid());
begin
  for p in
    select pl.id, pl.quantity, r.requester_id, r.card_id
    from public.pledges pl join public.requests r on r.id = pl.request_id
    where pl.event_id = p_event_id and pl.pledger_id = auth.uid()
  loop
    perform public.notify(p.requester_id, p_event_id, 'pledge_released', jsonb_build_object(
      'card', public.card_label(p.card_id), 'quantity', p.quantity,
      'actor', public.my_display_name(), 'reason', p_reason));
    delete from public.pledges where id = p.id;
  end loop;
  perform public.announce_needed_again(p_event_id, auth.uid(), public.my_display_name(), p_reason, v_released);
end;
$$;

-- Same as before, plus the announcement.
create or replace function public.unpledge(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  v_quantity int;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into req from public.requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_event_open(req.event_id);
  delete from public.pledges where request_id = p_request_id and pledger_id = auth.uid()
  returning quantity into v_quantity;
  if v_quantity is not null then
    perform public.notify(req.requester_id, req.event_id, 'pledge_released', jsonb_build_object(
      'card', public.card_label(req.card_id), 'quantity', v_quantity,
      'actor', public.my_display_name(), 'reason', 'unpledged'));
    perform public.announce_needed_again(req.event_id, auth.uid(), public.my_display_name(), 'unpledged',
      jsonb_build_array(jsonb_build_object(
        'requester_id', req.requester_id, 'card_id', req.card_id, 'quantity', v_quantity)));
  end if;
end;
$$;

-- Same as before, plus the announcement.
create or replace function public.remove_from_event(p_event_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce((select display_name from public.profiles where id = p_user_id), 'Someone');
  v_released jsonb := public.pledges_to_release(p_event_id, p_user_id);
  p record;
  r record;
begin
  for p in
    select pl.id, pl.quantity, req.requester_id, req.card_id
    from public.pledges pl join public.requests req on req.id = pl.request_id
    where pl.event_id = p_event_id and pl.pledger_id = p_user_id
  loop
    perform public.notify(p.requester_id, p_event_id, 'pledge_released', jsonb_build_object(
      'card', public.card_label(p.card_id), 'quantity', p.quantity, 'actor', actor, 'reason', 'removed'));
    delete from public.pledges where id = p.id;
  end loop;

  for r in
    select id, card_id from public.requests
    where event_id = p_event_id and requester_id = p_user_id and status = 'active'
    order by id
    for update
  loop
    for p in select id, pledger_id, quantity from public.pledges where request_id = r.id loop
      perform public.notify(p.pledger_id, p_event_id, 'request_cancelled', jsonb_build_object(
        'card', public.card_label(r.card_id), 'quantity', p.quantity, 'actor', actor, 'reason', 'removed'));
      delete from public.pledges where id = p.id;
    end loop;
    update public.requests set status = 'cancelled', updated_at = now() where id = r.id;
  end loop;

  delete from public.attendances where event_id = p_event_id and user_id = p_user_id;
  perform public.announce_needed_again(p_event_id, p_user_id, actor, 'removed', v_released);
end;
$$;

-- Grants (see *_explicit_api_grants.sql). Replaced functions keep theirs.
revoke execute on function
  public.event_audience(uuid, uuid[]),
  public.announce_needed_again(uuid, uuid, text, text, jsonb),
  public.pledges_to_release(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.event_audience(uuid, uuid[]),
  public.announce_needed_again(uuid, uuid, text, text, jsonb),
  public.pledges_to_release(uuid, uuid)
to service_role;
