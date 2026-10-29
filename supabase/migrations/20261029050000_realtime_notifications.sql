-- Phase 5: in-app notifications, leave-event options, and realtime broadcasts.

-- Notifications ------------------------------------------------------------

-- In-app notifications. Written only by the functions below; a future push
-- channel can deliver the same rows.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  kind text not null check (kind in ('pledge_released', 'request_cancelled')),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "users read their own notifications"
  on public.notifications for select to authenticated using (user_id = auth.uid());

create function public.card_label(p_card_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select name || coalesce(' (' || color || ')', '') from public.cards where id = p_card_id;
$$;

create function public.notify(p_user_id uuid, p_event_id uuid, p_kind text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, event_id, kind, payload)
  values (p_user_id, p_event_id, p_kind, p_payload);
$$;

revoke execute on function public.notify(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Display name of the current user, for notification text.
create function public.my_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(display_name, 'Someone') from public.profiles where id = auth.uid();
$$;

revoke execute on function public.my_display_name() from public, anon, authenticated;

create function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

revoke execute on function public.mark_notifications_read() from public, anon;

-- Request/pledge functions, now notifying affected users ----------------

-- Releases all of the caller's pledges on an event, telling each requester.
create function public.release_my_pledges(p_event_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
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
end;
$$;

revoke execute on function public.release_my_pledges(uuid, text) from public, anon, authenticated;

-- Cancels one request: tells each pledger, removes the pledges.
create function public.cancel_request_internal(p_request_id uuid, p_reason text)
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
      'actor', public.my_display_name(), 'reason', p_reason));
    delete from public.pledges where id = p.id;
  end loop;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_request_id;
end;
$$;

revoke execute on function public.cancel_request_internal(uuid, text) from public, anon, authenticated;

create or replace function public.cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_own_request(p_request_id);
  perform public.cancel_request_internal(p_request_id, 'cancelled');
end;
$$;

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
  end if;
end;
$$;

-- Leaving: pledges are always released; requests are cancelled on request.
drop function public.leave_event(uuid);

create function public.leave_event(p_event_id uuid, p_cancel_requests boolean default false)
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
      for update
    loop
      perform public.cancel_request_internal(r.id, 'left_event');
    end loop;
  end if;
  delete from public.attendances where event_id = p_event_id and user_id = auth.uid();
end;
$$;

revoke execute on function public.leave_event(uuid, boolean) from public, anon;

-- Realtime broadcasts ------------------------------------------------------

-- Tells everyone viewing an event that its lists changed. Statement-level, so
-- one SQL statement sends one message per affected event (not one per row),
-- keeping well under Realtime's rate limits. The payload is deliberately tiny;
-- clients re-fetch through RLS-checked queries.
create function public.broadcast_event_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  -- Transition tables: inserts/updates expose new_rows, deletes old_rows.
  if tg_op = 'DELETE' then
    for v_event_id in select distinct event_id from old_rows loop
      perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'change', 'event:' || v_event_id, true);
    end loop;
  else
    for v_event_id in select distinct event_id from new_rows loop
      perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'change', 'event:' || v_event_id, true);
    end loop;
  end if;
  return null;
end;
$$;

-- Postgres allows transition tables only on single-event triggers, hence three per table.
create trigger attendances_broadcast_ins after insert on public.attendances
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger attendances_broadcast_upd after update on public.attendances
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger attendances_broadcast_del after delete on public.attendances
  referencing old table as old_rows for each statement execute function public.broadcast_event_changes();

create trigger requests_broadcast_ins after insert on public.requests
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger requests_broadcast_upd after update on public.requests
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger requests_broadcast_del after delete on public.requests
  referencing old table as old_rows for each statement execute function public.broadcast_event_changes();

create trigger pledges_broadcast_ins after insert on public.pledges
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger pledges_broadcast_upd after update on public.pledges
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger pledges_broadcast_del after delete on public.pledges
  referencing old table as old_rows for each statement execute function public.broadcast_event_changes();

create function public.broadcast_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'notification', 'user:' || new.user_id::text, true);
  return null;
end;
$$;

create trigger notifications_broadcast after insert on public.notifications
  for each row execute function public.broadcast_notification();

-- Private-channel authorization: any signed-in user may listen to event
-- topics (event data is readable by all signed-in users anyway); only the
-- owner may listen to their user topic.
create policy "signed-in users receive event broadcasts"
  on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and realtime.topic() like 'event:%');

create policy "users receive their own notification broadcasts"
  on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and realtime.topic() = 'user:' || auth.uid()::text);
