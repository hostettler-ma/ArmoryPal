-- Format polls: players vote on which format an event runs (Draft, Classic
-- Constructed, Silver Age, Crack Shuffle Play); the owner confirms one.
-- A poll is one-time (owner_open_poll) or weekly (store_schedules.weekly_format_poll:
-- every new event of the slot gets one). Voting is open to the event's audience
-- (going + store followers) until the owner confirms or the event starts.
-- Format codes are mirrored by FORMATS in src/lib/formats.ts.

create function public.is_format(p_format text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_format in ('draft', 'cc', 'silver_age', 'csp');
$$;

-- 2 to 4 distinct known formats.
create function public.valid_format_options(p_options text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(p_options) between 2 and 4
    and (select bool_and(public.is_format(o)) from unnest(p_options) o)
    and cardinality(p_options) = (select count(distinct o) from unnest(p_options) o);
$$;

alter table public.events add column format text check (public.is_format(format));

alter table public.store_schedules
  add column weekly_format_poll boolean not null default false,
  add column poll_options text[] not null default array['draft', 'cc', 'silver_age', 'csp']
    check (public.valid_format_options(poll_options));

create table public.format_polls (
  event_id uuid primary key references public.events (id) on delete cascade,
  options text[] not null check (public.valid_format_options(options)),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table public.format_votes (
  event_id uuid not null references public.format_polls (event_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  format text not null check (public.is_format(format)),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.format_polls enable row level security;
alter table public.format_votes enable row level security;

-- Results are public to signed-in players; all writes go through the RPCs below.
create policy "format polls are readable by signed-in users"
  on public.format_polls for select to authenticated using (true);
create policy "format votes are readable by signed-in users"
  on public.format_votes for select to authenticated using (true);

-- Live results on the event topic.
create trigger format_polls_broadcast_ins after insert on public.format_polls
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger format_polls_broadcast_upd after update on public.format_polls
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger format_polls_broadcast_del after delete on public.format_polls
  referencing old table as old_rows for each statement execute function public.broadcast_event_changes();
create trigger format_votes_broadcast_ins after insert on public.format_votes
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger format_votes_broadcast_upd after update on public.format_votes
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger format_votes_broadcast_del after delete on public.format_votes
  referencing old table as old_rows for each statement execute function public.broadcast_event_changes();

-- Notification kinds ---------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided', 'event_moved', 'attendee_left',
                  'format_poll_opened', 'format_confirmed'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided', 'event_moved', 'attendee_left',
                  'format_poll_opened', 'format_confirmed'));

-- Weekly polls ------------------------------------------------------------------------

-- Every new event of a slot with weekly polls on gets a poll. Silent: weekly
-- polls show on the event instead of notifying every week.
create function public.events_weekly_poll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.format_polls (event_id, options)
  select new.id, sch.poll_options
  from public.store_schedules sch
  where sch.id = new.schedule_id and sch.weekly_format_poll
  on conflict do nothing;
  return null;
end;
$$;

create trigger events_weekly_poll after insert on public.events
  for each row execute function public.events_weekly_poll();

-- Helpers -------------------------------------------------------------------------

-- Tells the event's audience (minus the caller) about a poll or a format. Internal.
create function public.announce_format(p_event_id uuid, p_kind text, p_format text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_recipient uuid;
begin
  select jsonb_strip_nulls(jsonb_build_object('store', st.name, 'label', e.label, 'format', p_format))
  into v_payload
  from public.events e join public.stores st on st.id = e.store_id
  where e.id = p_event_id;
  for v_recipient in select * from public.event_audience(p_event_id, array[auth.uid()]) loop
    perform public.notify(v_recipient, p_event_id, p_kind, v_payload);
  end loop;
end;
$$;

-- Player RPCs ---------------------------------------------------------------------

create function public.vote_format(p_event_id uuid, p_format text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
  poll public.format_polls;
begin
  select * into poll from public.format_polls where event_id = p_event_id;
  if not found then
    raise exception 'no_poll' using errcode = 'P0002';
  end if;
  if poll.closed_at is not null or now() >= ev.starts_at then
    raise exception 'poll_closed' using errcode = 'P0001';
  end if;
  if not (p_format = any (poll.options)) then
    raise exception 'invalid_format' using errcode = '22023';
  end if;
  if not exists (select 1 from public.event_audience(p_event_id, '{}') a where a = auth.uid()) then
    raise exception 'not_in_audience' using errcode = 'P0001';
  end if;

  insert into public.format_votes (event_id, user_id, format)
  values (p_event_id, auth.uid(), p_format)
  on conflict (event_id, user_id) do update set format = excluded.format, updated_at = now();
end;
$$;

create function public.clear_format_vote(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
begin
  if exists (select 1 from public.format_polls where event_id = p_event_id
             and (closed_at is not null or now() >= ev.starts_at)) then
    raise exception 'poll_closed' using errcode = 'P0001';
  end if;
  delete from public.format_votes where event_id = p_event_id and user_id = auth.uid();
end;
$$;

-- Owner RPCs ----------------------------------------------------------------------

create function public.owner_open_poll(p_event_id uuid, p_options text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
begin
  perform public.assert_can_manage(ev.store_id);
  if not public.valid_format_options(p_options) then
    raise exception 'invalid_poll_options' using errcode = '22023';
  end if;
  if now() >= ev.starts_at then
    raise exception 'poll_closed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.format_polls where event_id = p_event_id) then
    raise exception 'poll_exists' using errcode = 'P0001';
  end if;
  insert into public.format_polls (event_id, options, created_by) values (p_event_id, p_options, auth.uid());
  perform public.announce_format(p_event_id, 'format_poll_opened', null);
end;
$$;

-- Weekly polls on or off for a slot. Turning them on also adds polls to the
-- slot's upcoming events that don't have one yet.
create function public.owner_set_weekly_poll(p_schedule_id uuid, p_on boolean, p_options text[])
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
  if not public.valid_format_options(p_options) then
    raise exception 'invalid_poll_options' using errcode = '22023';
  end if;
  update public.store_schedules set weekly_format_poll = p_on, poll_options = p_options where id = p_schedule_id;
  if p_on then
    insert into public.format_polls (event_id, options, created_by)
    select e.id, p_options, auth.uid()
    from public.events e
    where e.schedule_id = p_schedule_id and e.starts_at > now() and e.format is null
    on conflict do nothing;
  end if;
end;
$$;

-- Sets the event's format (with or without a poll) and closes its poll. Can be
-- changed until the event ends.
create function public.owner_confirm_format(p_event_id uuid, p_format text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
begin
  perform public.assert_can_manage(ev.store_id);
  if not coalesce(public.is_format(p_format), false) then
    raise exception 'invalid_format' using errcode = '22023';
  end if;
  update public.events set format = p_format where id = p_event_id;
  update public.format_polls set closed_at = coalesce(closed_at, now()) where event_id = p_event_id;
  if ev.format is distinct from p_format then
    perform public.announce_format(p_event_id, 'format_confirmed', p_format);
  end if;
end;
$$;

-- Removes a poll nobody voted in yet (opened by mistake, wrong options).
create function public.owner_delete_poll(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
begin
  perform public.assert_can_manage(ev.store_id);
  if exists (select 1 from public.format_votes where event_id = p_event_id) then
    raise exception 'poll_has_votes' using errcode = 'P0001';
  end if;
  delete from public.format_polls where event_id = p_event_id;
  if not found then
    raise exception 'no_poll' using errcode = 'P0002';
  end if;
end;
$$;

-- Grants (see *_explicit_api_grants.sql) -------------------------------------------

grant select on public.format_polls, public.format_votes to authenticated;
grant all on public.format_polls, public.format_votes to service_role;

revoke execute on function
  public.is_format(text),
  public.valid_format_options(text[]),
  public.events_weekly_poll(),
  public.announce_format(uuid, text, text),
  public.vote_format(uuid, text),
  public.clear_format_vote(uuid),
  public.owner_open_poll(uuid, text[]),
  public.owner_set_weekly_poll(uuid, boolean, text[]),
  public.owner_confirm_format(uuid, text),
  public.owner_delete_poll(uuid)
from public, anon;

-- Internal helpers (is_format/valid_format_options stay: check constraints use them).
revoke execute on function public.events_weekly_poll(), public.announce_format(uuid, text, text) from authenticated;

grant execute on function
  public.is_format(text),
  public.valid_format_options(text[]),
  public.vote_format(uuid, text),
  public.clear_format_vote(uuid),
  public.owner_open_poll(uuid, text[]),
  public.owner_set_weekly_poll(uuid, boolean, text[]),
  public.owner_confirm_format(uuid, text),
  public.owner_delete_poll(uuid)
to authenticated;

grant execute on function
  public.is_format(text),
  public.valid_format_options(text[]),
  public.events_weekly_poll(),
  public.announce_format(uuid, text, text),
  public.vote_format(uuid, text),
  public.clear_format_vote(uuid),
  public.owner_open_poll(uuid, text[]),
  public.owner_set_weekly_poll(uuid, boolean, text[]),
  public.owner_confirm_format(uuid, text),
  public.owner_delete_poll(uuid)
to service_role;
