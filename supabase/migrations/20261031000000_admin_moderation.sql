-- Admin moderation: remove a player from an event, ban/unban players,
-- archive or delete stores, and a log of every admin action.
-- Every rule lives here; the app only calls these RPCs.

-- Tables -------------------------------------------------------------------

-- Separate from profiles (readable by every signed-in user) so ban reasons stay private.
create table public.bans (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  banned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.bans enable row level security;

create policy "admins read all bans"
  on public.bans for select to authenticated using (public.is_admin());
create policy "users read their own ban"
  on public.bans for select to authenticated using (user_id = auth.uid());
-- No write policies: only the admin RPCs below write bans.

-- Targets are plain ids (not FKs) plus a name snapshot, so the log survives deletions.
create table public.admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in
    ('remove_attendee', 'ban', 'unban', 'archive_store', 'restore_store', 'delete_store')),
  target_user uuid,
  target_store uuid,
  target_event uuid,
  target_label text,
  detail text check (char_length(detail) <= 200),
  created_at timestamptz not null default now()
);

create index admin_actions_created_at on public.admin_actions (created_at desc);
create index admin_actions_target_user on public.admin_actions (target_user, created_at desc);

alter table public.admin_actions enable row level security;

create policy "admins read the admin log"
  on public.admin_actions for select to authenticated using (public.is_admin());

alter table public.stores add column archived_at timestamptz;

-- Notification kind for the removed player ------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event'));

-- Helpers ------------------------------------------------------------------

-- Is the caller banned? Callable by signed-in users (RLS policies use it); it
-- only ever reveals the caller's own status.
create function public.is_banned()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.bans where user_id = auth.uid());
$$;

create function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
end;
$$;

create function public.log_admin_action(
  p_action text, p_target_user uuid, p_target_store uuid, p_target_event uuid, p_target_label text, p_detail text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_actions (admin_id, action, target_user, target_store, target_event, target_label, detail)
  values (auth.uid(), p_action, p_target_user, p_target_store, p_target_event, p_target_label, nullif(btrim(p_detail), ''));
$$;

-- What leave_event does, for any user: release their pledges, cancel their
-- active requests, and drop their attendance. Notifications name the removed
-- player as the actor, with reason 'removed'. Same lock order as leave_event.
create function public.remove_from_event(p_event_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce((select display_name from public.profiles where id = p_user_id), 'Someone');
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
end;
$$;

-- Ban enforcement ----------------------------------------------------------

-- Every event write RPC (attend, add/update/cancel requests, pledge, unpledge,
-- copy, leave) already calls this, so banned players are blocked everywhere.
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
  select * into ev from public.events where id = p_event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if now() >= ev.ends_at then
    raise exception 'event_ended' using errcode = 'P0001';
  end if;
  return ev;
end;
$$;

-- Direct writes, too.
drop policy "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid() and not public.is_banned())
  with check (id = auth.uid() and not public.is_banned());

drop policy "users add to their own store list" on public.user_stores;
create policy "users add to their own store list"
  on public.user_stores for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned());
drop policy "users remove from their own store list" on public.user_stores;
create policy "users remove from their own store list"
  on public.user_stores for delete to authenticated
  using (user_id = auth.uid() and not public.is_banned());

drop policy "users add their own notification preferences" on public.notification_preferences;
create policy "users add their own notification preferences"
  on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned());
drop policy "users change their own notification preferences" on public.notification_preferences;
create policy "users change their own notification preferences"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid() and not public.is_banned())
  with check (user_id = auth.uid() and not public.is_banned());

-- Admin RPCs ---------------------------------------------------------------

create function public.admin_remove_attendee(p_event_id uuid, p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  perform public.assert_event_open(p_event_id);
  if char_length(btrim(coalesce(p_reason, ''))) > 200 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  if not exists (select 1 from public.attendances where event_id = p_event_id and user_id = p_user_id) then
    raise exception 'not_attending' using errcode = 'P0001';
  end if;

  perform public.remove_from_event(p_event_id, p_user_id);
  perform public.notify(p_user_id, p_event_id, 'removed_from_event',
    jsonb_strip_nulls(jsonb_build_object('note', nullif(btrim(p_reason), ''))));
  perform public.log_admin_action('remove_attendee', p_user_id, null, p_event_id,
    (select display_name from public.profiles where id = p_user_id), p_reason);
end;
$$;

create function public.admin_ban(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles;
  e record;
  r record;
begin
  perform public.assert_admin();
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select * into target from public.profiles where id = p_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot_ban_self' using errcode = 'P0001';
  end if;
  if target.is_admin then
    raise exception 'cannot_ban_admin' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bans where user_id = p_user_id) then
    raise exception 'already_banned' using errcode = 'P0001';
  end if;

  insert into public.bans (user_id, reason, banned_by) values (p_user_id, btrim(p_reason), auth.uid());

  -- Off every open event they're going to…
  for e in
    select a.event_id from public.attendances a join public.events ev on ev.id = a.event_id
    where a.user_id = p_user_id and ev.ends_at > now()
    order by a.event_id
  loop
    perform public.remove_from_event(e.event_id, p_user_id);
  end loop;
  -- …and cancel requests they kept open after leaving ("Not going").
  for r in
    select distinct req.event_id from public.requests req join public.events ev on ev.id = req.event_id
    where req.requester_id = p_user_id and req.status = 'active' and ev.ends_at > now()
  loop
    perform public.remove_from_event(r.event_id, p_user_id);
  end loop;

  perform public.log_admin_action('ban', p_user_id, null, null, target.display_name, p_reason);
end;
$$;

create function public.admin_unban(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  delete from public.bans where user_id = p_user_id;
  if not found then
    raise exception 'not_banned' using errcode = 'P0001';
  end if;
  perform public.log_admin_action('unban', p_user_id, null, null,
    (select display_name from public.profiles where id = p_user_id), null);
end;
$$;

-- Stores with any event are archived (hidden, no new events, history kept);
-- stores that never had an event are deleted. Returns 'archived' or 'deleted'.
create function public.admin_delete_store(p_store_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.stores;
begin
  perform public.assert_admin();
  select * into st from public.stores where id = p_store_id for update;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.events where store_id = p_store_id) then
    update public.stores set archived_at = coalesce(archived_at, now()) where id = p_store_id;
    update public.store_schedules set active = false where store_id = p_store_id;
    perform public.log_admin_action('archive_store', null, p_store_id, null, st.name, null);
    return 'archived';
  end if;

  delete from public.stores where id = p_store_id; -- schedules and user_stores cascade
  perform public.log_admin_action('delete_store', null, p_store_id, null, st.name, null);
  return 'deleted';
end;
$$;

-- Schedules stay inactive after a restore; the admin re-enables the ones still running.
create function public.admin_restore_store(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.stores;
begin
  perform public.assert_admin();
  update public.stores set archived_at = null where id = p_store_id and archived_at is not null
  returning * into st;
  if not found then
    raise exception 'store_not_archived' using errcode = 'P0001';
  end if;
  perform public.log_admin_action('restore_store', null, p_store_id, null, st.name, null);
end;
$$;

-- Players for the admin list, with email and sign-in provider from auth.users.
create function public.admin_list_players(p_query text default '', p_limit int default 50)
returns table (
  id uuid, display_name text, email text, provider text, created_at timestamptz, is_admin boolean, banned boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pattern text := '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform public.assert_admin();
  return query
  select p.id, p.display_name, u.email::text, (u.raw_app_meta_data ->> 'provider'), p.created_at, p.is_admin,
         exists (select 1 from public.bans b where b.user_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.display_name ilike pattern or u.email ilike pattern
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- Archived stores drop out of search (copy of *_search_stores_order.sql plus the filter).
create or replace function public.search_stores(q text)
returns setof public.stores
language sql
stable
set search_path = public, extensions
as $$
  with input as (
    select btrim(coalesce(q, '')) as term,
           replace(replace(replace(btrim(coalesce(q, '')), '\', '\\'), '%', '\%'), '_', '\_') as pattern
  ),
  ranked as (
    select s.id,
      case
        when i.term = '' then 0
        when lower(s.name) = lower(i.term) or lower(s.city) = lower(i.term) then 0
        when (' ' || s.name) ilike '% ' || i.pattern || '%' or (' ' || s.city) ilike '% ' || i.pattern || '%' then 1
        when s.name ilike '%' || i.pattern || '%' or s.city ilike '%' || i.pattern || '%' then 2
        else 3
      end as tier,
      -- Minutes since Monday 00:00 of the earliest active slot (weekday 0 = Sunday → last).
      (select min(((sc.weekday + 6) % 7) * 1440 + extract(hour from sc.start_time) * 60 + extract(minute from sc.start_time))
       from public.store_schedules sc
       where sc.store_id = s.id and sc.active) as week_minute
    from public.stores s, input i
    where s.archived_at is null
      and (i.term = ''
       or s.name ilike '%' || i.pattern || '%'
       or s.city ilike '%' || i.pattern || '%'
       or similarity(s.name, i.term) > 0.3
       or similarity(s.city, i.term) > 0.3)
  )
  -- s.* (not a column list) so new store columns flow through automatically.
  select s.*
  from ranked r
  join public.stores s on s.id = r.id
  order by r.tier, r.week_minute nulls last, s.name
  limit 50;
$$;

-- Grants (see *_explicit_api_grants.sql) -------------------------------------

grant select on public.bans, public.admin_actions to authenticated;
grant all on public.bans, public.admin_actions to service_role;
grant all on all sequences in schema public to service_role;

revoke execute on function
  public.is_banned(),
  public.assert_admin(),
  public.log_admin_action(text, uuid, uuid, uuid, text, text),
  public.remove_from_event(uuid, uuid),
  public.admin_remove_attendee(uuid, uuid, text),
  public.admin_ban(uuid, text),
  public.admin_unban(uuid),
  public.admin_delete_store(uuid),
  public.admin_restore_store(uuid),
  public.admin_list_players(text, int)
from public, anon;

-- Internal helpers: not callable through the API.
revoke execute on function
  public.assert_admin(),
  public.log_admin_action(text, uuid, uuid, uuid, text, text),
  public.remove_from_event(uuid, uuid)
from authenticated;

grant execute on function
  public.is_banned(), -- used by RLS policies
  public.admin_remove_attendee(uuid, uuid, text),
  public.admin_ban(uuid, text),
  public.admin_unban(uuid),
  public.admin_delete_store(uuid),
  public.admin_restore_store(uuid),
  public.admin_list_players(text, int)
to authenticated;

grant execute on function
  public.is_banned(),
  public.assert_admin(),
  public.log_admin_action(text, uuid, uuid, uuid, text, text),
  public.remove_from_event(uuid, uuid),
  public.admin_remove_attendee(uuid, uuid, text),
  public.admin_ban(uuid, text),
  public.admin_unban(uuid),
  public.admin_delete_store(uuid),
  public.admin_restore_store(uuid),
  public.admin_list_players(text, int)
to service_role;
