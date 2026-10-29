-- Phase 6: copy last week's unfilled requests to this week's event.

create index requests_copied_from_id on public.requests (copied_from_id) where copied_from_id is not null;

-- Copies the caller's still-needed requests from an ended event to the next
-- open event of the same weekly slot. Only the remaining quantity (requested
-- minus pledged) is copied; requests already copied are skipped, so this is
-- idempotent. Copies merge into an existing request for the same card.
-- Returns the number of requests copied. Sends one 'new_requests' notification.
create function public.copy_open_requests(p_from_event uuid, p_to_event uuid)
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
  v_attendee uuid;
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
    for v_attendee in
      select user_id from public.attendances where event_id = p_to_event and user_id <> auth.uid()
    loop
      perform public.notify(v_attendee, p_to_event, 'new_requests', jsonb_build_object(
        'actor', public.my_display_name(), 'card', v_first_card, 'items', v_count, 'copies', v_copies));
    end loop;
  end if;

  return v_count;
end;
$$;

revoke execute on function public.copy_open_requests(uuid, uuid) from public, anon;
