-- 'attendee_left': a store's owners hear when a player who was going leaves
-- (only when they leave themselves; admin removals and bans are visible in the
-- Going list anyway).

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided', 'event_moved', 'attendee_left'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided', 'event_moved', 'attendee_left'));

-- Same as before (*_notification_kinds_and_preferences.sql), plus the owners' notification.
create or replace function public.leave_event(p_event_id uuid, p_cancel_requests boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  ev public.events;
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  ev := public.assert_event_open(p_event_id);
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

  if found then
    for v_owner in
      select user_id from public.store_owners where store_id = ev.store_id and user_id <> auth.uid()
    loop
      perform public.notify(v_owner, p_event_id, 'attendee_left', jsonb_build_object(
        'actor', public.my_display_name(), 'label', ev.label,
        'when', public.format_event_time(ev.starts_at, (select timezone from public.stores where id = ev.store_id))));
    end loop;
  end if;
end;
$$;
