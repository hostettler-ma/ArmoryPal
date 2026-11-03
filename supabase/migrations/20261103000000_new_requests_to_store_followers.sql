-- 'new_requests' now also reaches players who saved the event's store (My
-- stores), not just attendees, so people who haven't said they're going yet
-- still hear that someone is looking for cards. Attendees who never saved the
-- store keep getting it. The requester and banned players are skipped.

-- Who hears about new requests on an event: its attendees plus everyone who
-- saved its store, minus the caller and banned players. Internal helper.
create function public.new_request_recipients(p_event_id uuid)
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
  select auth.uid();
$$;

-- add_requests: unchanged except for the recipients.
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
  v_recipient uuid;
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
  for v_recipient in select * from public.new_request_recipients(p_event_id) loop
    perform public.notify(v_recipient, p_event_id, 'new_requests', v_payload);
  end loop;
end;
$$;

-- copy_open_requests: unchanged except for the recipients.
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
  if from_ev.schedule_id <> to_ev.schedule_id or from_ev.ends_at > now() or from_ev.event_date >= to_ev.event_date then
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

-- Grants (see *_explicit_api_grants.sql). The replaced RPCs keep theirs.
revoke execute on function public.new_request_recipients(uuid) from public, anon, authenticated;
grant execute on function public.new_request_recipients(uuid) to service_role;
