-- Discord guests: players without an ArmoryPal account can tap Going on an
-- ArmoryBot post. They're listed on the event (in the post and on the Going
-- tab, marked "via Discord") but can't request or pledge cards: those need an
-- account. When the same Discord account later signs in to ArmoryPal (or is
-- connected to an existing account), its spots become real attendances.

-- Table ------------------------------------------------------------------------------------

create table public.discord_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  discord_id public.discord_snowflake not null,
  -- Server nickname, else Discord display name, else username (refreshed on every tap).
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (event_id, discord_id)
);

create index discord_attendees_discord_id on public.discord_attendees (discord_id);

alter table public.discord_attendees enable row level security;

-- Like attendances: every signed-in user sees who's going. The Discord ID
-- stays server-side (column grants below).
create policy "discord attendees are readable by signed-in users"
  on public.discord_attendees for select to authenticated using (true);

-- Live updates on the event page and the bot post, like attendances.
create trigger discord_attendees_broadcast_ins after insert on public.discord_attendees
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger discord_attendees_broadcast_upd after update on public.discord_attendees
  referencing new table as new_rows for each statement execute function public.broadcast_event_changes();
create trigger discord_attendees_broadcast_del after delete on public.discord_attendees
  referencing old table as old_rows for each statement execute function public.broadcast_event_changes();
create trigger discord_attendees_discord_ins after insert on public.discord_attendees
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger discord_attendees_discord_upd after update on public.discord_attendees
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger discord_attendees_discord_del after delete on public.discord_attendees
  referencing old table as old_rows for each statement execute function public.discord_child_changes();

-- Deleting a weekly event empties it (owner_delete_event): its guests go too.
-- (One-offs are deleted outright and cascade.)
create function public.discord_attendees_event_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.discord_attendees where event_id = new.id;
  return null;
end;
$$;

create trigger events_clear_discord_attendees after update of deleted_at on public.events
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.discord_attendees_event_deleted();

-- Claiming: guest spots → attendances -------------------------------------------------------

-- Turns the user's Discord guest spots into attendances, keeping their place
-- in the join order, then drops the guest rows. Needs Discord linked and a
-- display name; a banned player's spots are dropped, not claimed.
create function public.claim_discord_spots(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discord text := public.discord_id_for_user(p_user_id);
  v_count int := 0;
begin
  if v_discord is null or (select display_name from public.profiles where id = p_user_id) is null then
    return 0;
  end if;
  if not public.is_user_banned(p_user_id) then
    insert into public.attendances (event_id, user_id, created_at)
    select g.event_id, p_user_id, g.created_at
    from public.discord_attendees g
    join public.events e on e.id = g.event_id and e.deleted_at is null
    where g.discord_id = v_discord
    on conflict do nothing;
    get diagnostics v_count = row_count;
  end if;
  delete from public.discord_attendees where discord_id = v_discord;
  return v_count;
end;
$$;

-- Called by /auth/callback after every sign-in and Discord connect.
create function public.claim_my_discord_spots()
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  return public.claim_discord_spots(auth.uid());
end;
$$;

-- Accounts that pick their display name after connecting Discord claim then.
create function public.profiles_claim_discord_spots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.claim_discord_spots(new.id);
  return null;
end;
$$;

create trigger profiles_claim_discord_spots after update of display_name on public.profiles
  for each row when (old.display_name is null and new.display_name is not null)
  execute function public.profiles_claim_discord_spots();

-- Bot RPCs -------------------------------------------------------------------------------------

-- Going button. Linked players attend as themselves (the app's rules); anyone
-- else goes on the list as a Discord guest. Returns 'member' or 'guest'.
drop function public.bot_attend(text, uuid);

create function public.bot_attend(p_discord_id text, p_event_id uuid, p_display_name text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_name text := left(btrim(coalesce(p_display_name, '')), 40);
begin
  if public.user_for_discord(p_discord_id) is not null then
    v_uid := public.bot_resolve(p_discord_id); -- banned / profile_incomplete
    perform public.claim_discord_spots(v_uid);
    perform public.attend_event_as(p_event_id, v_uid);
    return 'member';
  end if;

  perform public.assert_event_open_for(p_event_id, null);
  insert into public.discord_attendees (event_id, discord_id, display_name)
  values (p_event_id, p_discord_id, case when v_name = '' then 'Discord player' else v_name end)
  on conflict (event_id, discord_id) do update set display_name = excluded.display_name
    where public.discord_attendees.display_name is distinct from excluded.display_name;
  return 'guest';
end;
$$;

-- Not going, for a Discord guest: off the list. False if they weren't on it.
create function public.bot_guest_leave(p_discord_id text, p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_event_open_for(p_event_id, null);
  delete from public.discord_attendees where event_id = p_event_id and discord_id = p_discord_id;
  return found;
end;
$$;

-- Same as *_armorybot.sql, with Discord guests merged into 'going' by join time.
create or replace function public.bot_render_event(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with active as (
    select r.*, coalesce((select sum(quantity) from public.pledges where request_id = r.id), 0)::int as pledged
    from public.requests r
    where r.event_id = p_event_id and r.status = 'active'
  ),
  counts as (
    select requester_id, count(*)::int as n, min(created_at) as first_at from active group by requester_id
  )
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id', e.id, 'label', e.label, 'event_date', e.event_date, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
      'cancelled_at', e.cancelled_at, 'cancel_note', e.cancel_note, 'format', e.format,
      'one_off', e.schedule_id is null, 'moved_from', e.moved_from),
    'store', jsonb_build_object(
      'id', s.id, 'name', s.name, 'city', s.city, 'region', s.region, 'country', s.country, 'timezone', s.timezone),
    -- Join order, as on the Going tab; Discord guests have no requests.
    'going', (
      select coalesce(jsonb_agg(jsonb_build_object('name', g.name, 'requests', g.requests)
        order by g.created_at, g.tiebreak), '[]'::jsonb)
      from (
        select coalesce(p.display_name, 'Someone') as name, coalesce(c.n, 0) as requests, a.created_at, a.user_id::text as tiebreak
        from public.attendances a
        join public.profiles p on p.id = a.user_id
        left join counts c on c.requester_id = a.user_id
        where a.event_id = e.id
        union all
        select d.display_name, 0, d.created_at, d.id::text
        from public.discord_attendees d
        where d.event_id = e.id
      ) g),
    -- Left, but kept their requests.
    'not_going', (
      select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(p.display_name, 'Someone'), 'requests', c.n)
        order by c.first_at, c.requester_id), '[]'::jsonb)
      from counts c
      join public.profiles p on p.id = c.requester_id
      where not exists (select 1 from public.attendances a where a.event_id = e.id and a.user_id = c.requester_id)),
    -- Still-needed requests, most copies needed first (at most 50; open_count has the total).
    'open_requests', (
      select coalesce(jsonb_agg(x.item order by x.remaining desc, x.created_at, x.id), '[]'::jsonb)
      from (
        select ar.id, ar.created_at, ar.quantity - ar.pledged as remaining,
          jsonb_build_object('card', cd.name, 'pitch', cd.pitch, 'remaining', ar.quantity - ar.pledged,
                             'requester', coalesce(p.display_name, 'Someone')) as item
        from active ar
        join public.cards cd on cd.id = ar.card_id
        join public.profiles p on p.id = ar.requester_id
        where ar.quantity > ar.pledged
        order by ar.quantity - ar.pledged desc, ar.created_at, ar.id
        limit 50) x),
    'open_count', (select count(*) from active where quantity > pledged),
    'request_count', (select count(*) from active),
    'poll', (
      select jsonb_build_object('options', fp.options, 'closed_at', fp.closed_at, 'weekly', fp.weekly,
        'votes', (select coalesce(jsonb_object_agg(v.format, v.n), '{}'::jsonb)
                  from (select format, count(*)::int as n from public.format_votes
                        where event_id = e.id group by format) v))
      from public.format_polls fp where fp.event_id = e.id)
  )
  from public.events e
  join public.stores s on s.id = e.store_id
  where e.id = p_event_id and e.deleted_at is null;
$$;

-- Admin: take a Discord guest off an open event (logged like admin_remove_attendee).
create function public.admin_remove_discord_attendee(p_attendee_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.discord_attendees;
begin
  perform public.assert_admin();
  if char_length(btrim(coalesce(p_reason, ''))) > 200 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  select * into g from public.discord_attendees where id = p_attendee_id;
  if not found then
    raise exception 'not_attending' using errcode = 'P0001';
  end if;
  perform public.assert_event_open(g.event_id);
  delete from public.discord_attendees where id = g.id;
  perform public.log_admin_action('remove_attendee', null, null, g.event_id, g.display_name || ' (via Discord)', p_reason);
end;
$$;

-- Grants (see *_explicit_api_grants.sql) ------------------------------------------------------

revoke all on table public.discord_attendees from public, anon, authenticated;
grant select (id, event_id, display_name, created_at) on public.discord_attendees to authenticated;
grant all on table public.discord_attendees to service_role;

revoke execute on function
  public.discord_attendees_event_deleted(),
  public.claim_discord_spots(uuid),
  public.claim_my_discord_spots(),
  public.profiles_claim_discord_spots(),
  public.bot_attend(text, uuid, text),
  public.bot_guest_leave(text, uuid),
  public.admin_remove_discord_attendee(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.claim_discord_spots(uuid),
  public.bot_attend(text, uuid, text),
  public.bot_guest_leave(text, uuid)
to service_role;

grant execute on function
  public.claim_my_discord_spots(),
  public.admin_remove_discord_attendee(uuid, text)
to authenticated, service_role;
