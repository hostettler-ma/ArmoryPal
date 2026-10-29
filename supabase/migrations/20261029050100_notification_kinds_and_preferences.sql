-- More notification kinds (requests_filled, new_requests) and per-user
-- preferences to turn each kind on or off.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests'));

-- Preferences: one row per user per kind. No row = enabled (the default).
create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.notification_preferences enable row level security;

create policy "users read their own notification preferences"
  on public.notification_preferences for select to authenticated using (user_id = auth.uid());
create policy "users add their own notification preferences"
  on public.notification_preferences for insert to authenticated with check (user_id = auth.uid());
create policy "users change their own notification preferences"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notify() now skips kinds the recipient turned off, so nothing is stored.
create or replace function public.notify(p_user_id uuid, p_event_id uuid, p_kind text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, event_id, kind, payload)
  select p_user_id, p_event_id, p_kind, p_payload
  where not exists (
    select 1 from public.notification_preferences
    where user_id = p_user_id and kind = p_kind and not enabled
  );
$$;

-- add_requests: same as before, plus ONE 'new_requests' notification per call
-- to every other attendee, however many cards were added.
create or replace function public.add_requests(p_event_id uuid, p_items jsonb, p_note text default null)
returns setof public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_note text := nullif(btrim(p_note), '');
  v_copies int := 0;
  v_attendee uuid;
  v_payload jsonb;
begin
  perform public.assert_event_open(p_event_id);
  perform public.assert_attending(p_event_id);

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    if coalesce((item ->> 'quantity')::int, 0) not between 1 and 20 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.cards where id = item ->> 'card_id') then
      raise exception 'card_not_found' using errcode = 'P0001';
    end if;
    v_copies := v_copies + (item ->> 'quantity')::int;

    return query
    insert into public.requests as r (event_id, requester_id, card_id, quantity, note)
    values (p_event_id, auth.uid(), item ->> 'card_id', (item ->> 'quantity')::int, v_note)
    on conflict (event_id, requester_id, card_id) where status = 'active'
    do update set
      quantity = least(r.quantity + excluded.quantity, 20),
      note = coalesce(excluded.note, r.note),
      updated_at = now()
    returning *;
  end loop;

  v_payload := jsonb_build_object(
    'actor', public.my_display_name(),
    'card', public.card_label(p_items -> 0 ->> 'card_id'),
    'items', jsonb_array_length(p_items),
    'copies', v_copies);
  for v_attendee in
    select user_id from public.attendances where event_id = p_event_id and user_id <> auth.uid()
  loop
    perform public.notify(v_attendee, p_event_id, 'new_requests', v_payload);
  end loop;
end;
$$;

-- pledge: same rules as before, plus a 'requests_filled' notification when this
-- pledge covers the requester's last unfilled request on the event. All of the
-- requester's active requests on the event are locked (in id order) so two
-- concurrent pledges covering the last two requests can't both miss it.
create or replace function public.pledge(p_request_id uuid, p_quantity int)
returns public.pledges
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  v_others int;
  v_before int;
  v_unfilled int;
  v_summary record;
  result public.pledges;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into req from public.requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  perform 1 from public.requests
  where event_id = req.event_id and requester_id = req.requester_id and (status = 'active' or id = p_request_id)
  order by id
  for update;
  select * into req from public.requests where id = p_request_id; -- re-read under lock

  perform public.assert_event_open(req.event_id);
  perform public.assert_attending(req.event_id);
  if req.status <> 'active' then
    raise exception 'request_cancelled' using errcode = 'P0001';
  end if;
  if req.requester_id = auth.uid() then
    raise exception 'own_request' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;

  select coalesce(sum(quantity) filter (where pledger_id <> auth.uid()), 0), coalesce(sum(quantity), 0)
  into v_others, v_before
  from public.pledges
  where request_id = p_request_id;
  if p_quantity > req.quantity - v_others then
    raise exception 'exceeds_remaining' using errcode = 'P0001';
  end if;

  insert into public.pledges (request_id, event_id, pledger_id, quantity)
  values (p_request_id, req.event_id, auth.uid(), p_quantity)
  on conflict (request_id, pledger_id)
  do update set quantity = excluded.quantity, updated_at = now()
  returning * into result;

  -- Just became covered? Then check whether everything else is covered too.
  if v_before < req.quantity and v_others + p_quantity >= req.quantity then
    select count(*) into v_unfilled
    from public.requests r
    where r.event_id = req.event_id and r.requester_id = req.requester_id and r.status = 'active'
      and r.quantity > (select coalesce(sum(quantity), 0) from public.pledges where request_id = r.id);
    if v_unfilled = 0 then
      select count(*) as requests, coalesce(sum(quantity), 0) as copies into v_summary
      from public.requests
      where event_id = req.event_id and requester_id = req.requester_id and status = 'active';
      perform public.notify(req.requester_id, req.event_id, 'requests_filled', jsonb_build_object(
        'requests', v_summary.requests, 'copies', v_summary.copies, 'actor', public.my_display_name()));
    end if;
  end if;

  return result;
end;
$$;

-- Lock in a consistent (id) order, matching pledge(), to avoid deadlocks.
create or replace function public.leave_event(p_event_id uuid, p_cancel_requests boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform public.assert_event_open(p_event_id);
  perform public.release_my_pledges(p_event_id, 'left_event');
  if p_cancel_requests then
    for r in
      select id from public.requests
      where event_id = p_event_id and requester_id = auth.uid() and status = 'active'
      order by id
      for update
    loop
      perform public.cancel_request_internal(r.id, 'left_event');
    end loop;
  end if;
  delete from public.attendances where event_id = p_event_id and user_id = auth.uid();
end;
$$;
