-- ArmoryBot groundwork (docs/armorybot.md §3–4): Discord identity lookup,
-- server ↔ store links, the posts and outbox tables the worker drains, the
-- per-user DM queue, the Discord DM preference channel, and the bot_* RPCs.
--
-- Everything here is reachable only with the secret key (service_role). The
-- Edge Functions call bot_* RPCs and never touch tables directly. The one
-- exception for players: they read their own discord_dm_status row.

-- Domains ------------------------------------------------------------------------------

create domain public.notification_channel as text
  constraint notification_channel_check check (value in ('app', 'discord'));

create domain public.discord_outbox_kind as text
  constraint discord_outbox_kind_check check (value in ('refresh', 'cancelled', 'moved', 'delete_posts'));

-- Discord IDs ("snowflakes") are 64-bit, beyond JS's safe integers: keep them as text.
create domain public.discord_snowflake as text
  constraint discord_snowflake_check check (value ~ '^[0-9]{1,20}$');

grant usage on domain public.notification_channel, public.discord_outbox_kind, public.discord_snowflake
  to authenticated, service_role;

-- Notification preferences get a channel --------------------------------------------------
-- In-app ('app'): a missing row means on (unchanged). Discord DMs ('discord'):
-- a missing row means OFF; players opt in per kind. Mirrored by
-- isNotificationEnabled() in src/lib/notifications.ts.

alter table public.notification_preferences
  add column channel public.notification_channel not null default 'app',
  drop constraint notification_preferences_pkey,
  add primary key (user_id, kind, channel),
  add constraint notification_preferences_discord_kinds
    check (channel = 'app' or kind in ('new_requests', 'card_needed_again'));

-- Tables -----------------------------------------------------------------------------------

-- A Discord server showing a store's events in one of its channels. A server
-- links each store once; a server can link several stores and a store several servers.
create table public.discord_guild_stores (
  guild_id public.discord_snowflake not null,
  store_id uuid not null references public.stores (id) on delete cascade,
  channel_id public.discord_snowflake not null,
  days_before smallint not null default 2 check (days_before between 0 and 6),
  post_time time not null default '10:00', -- store-local
  linked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set by the worker when Discord says the channel or server is gone, or the bot lost access.
  broken_at timestamptz,
  broken_reason text check (char_length(broken_reason) <= 200),
  primary key (guild_id, store_id)
);

create index discord_guild_stores_store_id on public.discord_guild_stores (store_id);
create index discord_guild_stores_linked_by on public.discord_guild_stores (linked_by) where linked_by is not null;

-- One bot post per server per event. No FK to events on purpose: when a
-- one-off event is deleted, the message IDs must outlive it so the worker can
-- delete the Discord messages.
create table public.discord_event_posts (
  guild_id public.discord_snowflake not null,
  event_id uuid not null,
  channel_id public.discord_snowflake not null,
  message_id public.discord_snowflake, -- null while the post is being created
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  last_rendered_at timestamptz,
  render_hash text,
  finalized_at timestamptz, -- last render after the event ended (buttons off); no edits after
  gone_at timestamptz,      -- the message was deleted (by us or by a moderator)
  primary key (guild_id, event_id)
);

create index discord_event_posts_event_id on public.discord_event_posts (event_id);

-- Event-level work for the worker, filled by triggers. Pending rows are
-- coalesced per (kind, event): a burst of changes queues one row.
create table public.discord_outbox (
  id bigint generated always as identity primary key,
  kind public.discord_outbox_kind not null,
  event_id uuid not null, -- no FK: see discord_event_posts
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  claimed_until timestamptz,
  attempts int not null default 0,
  processed_at timestamptz,
  failed_at timestamptz,
  last_error text
);

create unique index discord_outbox_pending on public.discord_outbox (kind, event_id)
  where processed_at is null and failed_at is null and claimed_until is null;
create index discord_outbox_due on public.discord_outbox (next_attempt_at)
  where processed_at is null and failed_at is null;

-- Per-player DM deliveries, queued by notify() for players who linked Discord
-- and turned the DM on. The worker sends one batched DM per player.
create table public.discord_dm_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  discord_id public.discord_snowflake not null,
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.notification_kind not null check (kind in ('new_requests', 'card_needed_again')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  send_after timestamptz not null,
  claimed_until timestamptz,
  sent_at timestamptz,
  dropped_reason text
);

create index discord_dm_queue_pending on public.discord_dm_queue (user_id, send_after)
  where sent_at is null and dropped_reason is null;
create index discord_dm_queue_event_id on public.discord_dm_queue (event_id);

-- Players Discord wouldn't let us DM (50007: privacy settings or blocked;
-- 50278: no server in common with the bot). DMs pause for 24 hours, then are
-- tried again; a successful DM deletes the row.
create table public.discord_dm_status (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  undeliverable_at timestamptz not null,
  error_code int not null
);

alter table public.discord_guild_stores enable row level security;
alter table public.discord_event_posts enable row level security;
alter table public.discord_outbox enable row level security;
alter table public.discord_dm_queue enable row level security;
alter table public.discord_dm_status enable row level security;

create policy "players read their own DM status"
  on public.discord_dm_status for select to authenticated using (user_id = auth.uid());

-- Identity ---------------------------------------------------------------------------------
-- A player's Discord ID is auth.identities.provider_id for provider 'discord'.
-- (provider_id, provider) is unique in auth.identities, so a Discord account
-- belongs to at most one ArmoryPal account (checked in tests/db/discord.test.ts).

create function public.user_for_discord(p_discord_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from auth.identities where provider = 'discord' and provider_id = p_discord_id;
$$;

create function public.discord_id_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select provider_id from auth.identities
  where provider = 'discord' and user_id = p_user_id
  order by created_at
  limit 1;
$$;

-- Every player-facing bot RPC starts here: Discord user → ArmoryPal user, or an error.
create function public.bot_resolve(p_discord_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.user_for_discord(p_discord_id);
begin
  if v_uid is null then
    raise exception 'discord_not_linked' using errcode = '42501';
  end if;
  if public.is_user_banned(v_uid) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if (select display_name from public.profiles where id = v_uid) is null then
    raise exception 'profile_incomplete' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- notify(): in-app unchanged, plus the Discord DM queue ------------------------------------

create or replace function public.notify(p_user_id uuid, p_event_id uuid, p_kind text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  -- In-app: on unless turned off.
  insert into public.notifications (user_id, event_id, kind, payload)
  select p_user_id, p_event_id, p_kind, p_payload
  where not exists (
    select 1 from public.notification_preferences
    where user_id = p_user_id and kind = p_kind and channel = 'app' and not enabled
  );

  -- Discord DM: off unless turned on, only with Discord linked, paused after Discord refused one.
  insert into public.discord_dm_queue (user_id, discord_id, event_id, kind, payload, send_after)
  select p_user_id, d.discord_id, p_event_id, p_kind, p_payload, now() + interval '2 minutes'
  from (select public.discord_id_for_user(p_user_id) as discord_id) d
  where p_kind in ('new_requests', 'card_needed_again')
    and exists (
      select 1 from public.notification_preferences
      where user_id = p_user_id and kind = p_kind and channel = 'discord' and enabled
    )
    and d.discord_id is not null
    and not exists (
      select 1 from public.discord_dm_status s
      where s.user_id = p_user_id and s.undeliverable_at > now() - interval '24 hours'
    );
$$;

-- Outbox triggers ------------------------------------------------------------------------

-- Queues one row per event that has a live Discord post (others cost one index lookup).
create function public.queue_discord_sync(p_event_ids uuid[], p_kind text, p_delay interval default interval '2 seconds')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.discord_outbox (kind, event_id, next_attempt_at)
  select p_kind, x.event_id, now() + p_delay
  from (select distinct unnest(p_event_ids) as event_id) x
  where exists (
    select 1 from public.discord_event_posts p
    where p.event_id = x.event_id and p.gone_at is null and p.finalized_at is null
  )
  on conflict (kind, event_id) where processed_at is null and failed_at is null and claimed_until is null
  do nothing;
$$;

-- Queues deleting an event's Discord messages, carrying the message list
-- (the event row may be about to disappear), and drops its unsent DMs.
create function public.queue_discord_delete(p_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.discord_dm_queue where event_id = p_event_id and sent_at is null;

  insert into public.discord_outbox (kind, event_id, payload)
  select 'delete_posts', p_event_id, jsonb_build_object('posts', jsonb_agg(jsonb_build_object(
    'guild_id', p.guild_id, 'channel_id', p.channel_id, 'message_id', p.message_id)))
  from public.discord_event_posts p
  where p.event_id = p_event_id and p.gone_at is null and p.message_id is not null
  having count(*) > 0
  on conflict (kind, event_id) where processed_at is null and failed_at is null and claimed_until is null
  do nothing;
$$;

-- Attendance, requests, pledges, polls and votes: re-render the event's posts.
create function public.discord_child_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.queue_discord_sync(array(select distinct event_id from old_rows), 'refresh');
  else
    perform public.queue_discord_sync(array(select distinct event_id from new_rows), 'refresh');
  end if;
  return null;
end;
$$;

-- Transition tables need one trigger per operation.
create trigger attendances_discord_ins after insert on public.attendances
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger attendances_discord_upd after update on public.attendances
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger attendances_discord_del after delete on public.attendances
  referencing old table as old_rows for each statement execute function public.discord_child_changes();
create trigger requests_discord_ins after insert on public.requests
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger requests_discord_upd after update on public.requests
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger requests_discord_del after delete on public.requests
  referencing old table as old_rows for each statement execute function public.discord_child_changes();
create trigger pledges_discord_ins after insert on public.pledges
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger pledges_discord_upd after update on public.pledges
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger pledges_discord_del after delete on public.pledges
  referencing old table as old_rows for each statement execute function public.discord_child_changes();
create trigger format_polls_discord_ins after insert on public.format_polls
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger format_polls_discord_upd after update on public.format_polls
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger format_polls_discord_del after delete on public.format_polls
  referencing old table as old_rows for each statement execute function public.discord_child_changes();
create trigger format_votes_discord_ins after insert on public.format_votes
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger format_votes_discord_upd after update on public.format_votes
  referencing new table as new_rows for each statement execute function public.discord_child_changes();
create trigger format_votes_discord_del after delete on public.format_votes
  referencing old table as old_rows for each statement execute function public.discord_child_changes();

-- Events: deleted (weekly marker) → delete posts; cancelled → cancelled
-- state; moved → moved; anything else (rename, format, links) → refresh.
create function public.discord_event_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    perform public.queue_discord_delete(new.id);
  elsif new.deleted_at is not null then
    null;
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    perform public.queue_discord_sync(array[new.id], 'cancelled', interval '0 seconds');
  elsif new.starts_at is distinct from old.starts_at then
    perform public.queue_discord_sync(array[new.id], 'moved', interval '0 seconds');
  elsif old is distinct from new then
    perform public.queue_discord_sync(array[new.id], 'refresh');
  end if;
  return null;
end;
$$;

create trigger events_discord_upd after update on public.events
  for each row execute function public.discord_event_changes();

-- One-off events are deleted outright: capture the posts before the row goes.
create function public.discord_event_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.queue_discord_delete(old.id);
  return old;
end;
$$;

create trigger events_discord_del before delete on public.events
  for each row execute function public.discord_event_deleted();

-- The post's author line shows the store's name and area.
create function public.discord_store_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.name, old.city, old.region, old.country) is distinct from (new.name, new.city, new.region, new.country) then
    perform public.queue_discord_sync(
      array(select id from public.events where store_id = new.id and ends_at > now()), 'refresh');
  end if;
  return null;
end;
$$;

create trigger stores_discord_upd after update on public.stores
  for each row execute function public.discord_store_changes();

-- Server links ------------------------------------------------------------------------------

-- When a server's post for this event is due (store-local).
create function public.discord_post_at(p_event_date date, p_days_before smallint, p_post_time time, p_timezone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_event_date - p_days_before) + p_post_time) at time zone p_timezone;
$$;

-- The server's link for a store; with no store given, the server's only link.
create function public.discord_link_for(p_guild_id text, p_store_id uuid)
returns public.discord_guild_stores
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.discord_guild_stores;
  v_count int;
begin
  if p_store_id is not null then
    select * into v_link from public.discord_guild_stores where guild_id = p_guild_id and store_id = p_store_id;
    if not found then
      raise exception 'store_not_linked' using errcode = 'P0002';
    end if;
    return v_link;
  end if;
  select count(*) into v_count from public.discord_guild_stores where guild_id = p_guild_id;
  if v_count = 0 then
    raise exception 'store_not_linked' using errcode = 'P0002';
  elsif v_count > 1 then
    raise exception 'store_required' using errcode = '22023';
  end if;
  select * into v_link from public.discord_guild_stores where guild_id = p_guild_id;
  return v_link;
end;
$$;

-- bot_* RPCs: player and server commands ------------------------------------------------------

-- Store autocomplete for /armory link-store (max 25: Discord's limit).
create function public.bot_search_stores(p_query text)
returns table (id uuid, name text, city text, region text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.city, s.region
  from public.search_stores(p_query) s
  where s.archived_at is null
  limit 25;
$$;

-- /armory link-store: only the store's owners (or admins), with Discord linked.
create function public.bot_link_store(p_discord_id text, p_guild_id text, p_channel_id text, p_store_id uuid)
returns public.discord_guild_stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.bot_resolve(p_discord_id);
  v_link public.discord_guild_stores;
begin
  if not exists (select 1 from public.stores where id = p_store_id and archived_at is null) then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;
  if not public.can_user_manage_store(v_uid, p_store_id) then
    raise exception 'not_store_owner' using errcode = '42501';
  end if;
  insert into public.discord_guild_stores (guild_id, store_id, channel_id, linked_by)
  values (p_guild_id, p_store_id, p_channel_id, v_uid)
  on conflict (guild_id, store_id) do update
    set channel_id = excluded.channel_id, broken_at = null, broken_reason = null, updated_at = now()
  returning * into v_link;
  return v_link;
end;
$$;

-- /armory settings: same permission as linking. Null arguments stay as they are.
create function public.bot_update_settings(
  p_discord_id text, p_guild_id text, p_store_id uuid default null,
  p_days_before int default null, p_post_time time default null, p_channel_id text default null
)
returns public.discord_guild_stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.bot_resolve(p_discord_id);
  v_link public.discord_guild_stores := public.discord_link_for(p_guild_id, p_store_id);
begin
  if not public.can_user_manage_store(v_uid, v_link.store_id) then
    raise exception 'not_store_owner' using errcode = '42501';
  end if;
  if p_days_before is not null and p_days_before not between 0 and 6 then
    raise exception 'invalid_days_before' using errcode = '22023';
  end if;
  update public.discord_guild_stores
  set days_before = coalesce(p_days_before, days_before),
      post_time = coalesce(p_post_time, post_time),
      channel_id = coalesce(p_channel_id, channel_id),
      broken_at = case when p_channel_id is null then broken_at end,
      broken_reason = case when p_channel_id is null then broken_reason end,
      updated_at = now()
  where guild_id = v_link.guild_id and store_id = v_link.store_id
  returning * into v_link;
  return v_link;
end;
$$;

-- /armory unlink: a store manager, or anyone with Manage Server in that server
-- (p_has_manage_guild comes from the interaction's signed member.permissions),
-- so a server can always remove the bot. Existing posts get a last render.
create function public.bot_unlink_store(
  p_discord_id text, p_guild_id text, p_store_id uuid default null, p_has_manage_guild boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.discord_guild_stores := public.discord_link_for(p_guild_id, p_store_id);
begin
  if not coalesce(p_has_manage_guild, false)
     and not public.can_user_manage_store(public.bot_resolve(p_discord_id), v_link.store_id) then
    raise exception 'not_store_owner' using errcode = '42501';
  end if;
  delete from public.discord_guild_stores where guild_id = v_link.guild_id and store_id = v_link.store_id;
  perform public.queue_discord_sync(array(
    select p.event_id from public.discord_event_posts p
    join public.events e on e.id = p.event_id
    where p.guild_id = v_link.guild_id and e.store_id = v_link.store_id), 'refresh');
  return v_link.store_id;
end;
$$;

-- /armory status: the server's links and each one's next scheduled post.
create function public.bot_status(p_guild_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_current_events(array(
    select store_id from public.discord_guild_stores where guild_id = p_guild_id));

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'store_id', s.id, 'store', s.name, 'channel_id', l.channel_id,
      'days_before', l.days_before, 'post_time', to_char(l.post_time, 'HH24:MI'),
      'broken_at', l.broken_at, 'broken_reason', l.broken_reason,
      'next_post', (
        select jsonb_build_object(
          'event_id', e.id, 'label', e.label, 'starts_at', e.starts_at,
          'post_at', public.discord_post_at(e.event_date, l.days_before, l.post_time, s.timezone))
        from public.events e
        where e.store_id = s.id and e.deleted_at is null and e.ends_at > now()
          and not exists (select 1 from public.discord_event_posts p where p.guild_id = l.guild_id and p.event_id = e.id)
        order by e.starts_at
        limit 1)
    ) order by s.name), '[]'::jsonb)
    from public.discord_guild_stores l
    join public.stores s on s.id = l.store_id
    where l.guild_id = p_guild_id
  );
end;
$$;

-- Going button: the same rules as the app (open, not cancelled, not banned, …).
create function public.bot_attend(p_discord_id text, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.attend_event_as(p_event_id, public.bot_resolve(p_discord_id));
end;
$$;

-- Not going: the app's leave flow, keeping or cancelling the player's requests.
create function public.bot_leave(p_discord_id text, p_event_id uuid, p_cancel_requests boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.bot_resolve(p_discord_id);
begin
  perform public.assert_event_open_for(p_event_id, v_uid);
  perform public.leave_event_as(p_event_id, v_uid, coalesce(p_cancel_requests, false), 'left_event', true);
end;
$$;

-- Requests button: the event's active requests from this player's point of view.
create function public.bot_event_requests(p_discord_id text, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.bot_resolve(p_discord_id);
begin
  if not exists (select 1 from public.events where id = p_event_id and deleted_at is null) then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'attending', exists (select 1 from public.attendances where event_id = p_event_id and user_id = v_uid),
    'requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'card', c.name, 'pitch', c.pitch, 'quantity', r.quantity,
        'pledged', coalesce((select sum(quantity) from public.pledges where request_id = r.id), 0),
        'my_pledge', coalesce((select quantity from public.pledges where request_id = r.id and pledger_id = v_uid), 0),
        'requester', coalesce(p.display_name, 'Someone'), 'is_mine', r.requester_id = v_uid, 'note', r.note
      ) order by r.created_at, r.id), '[]'::jsonb)
      from public.requests r
      join public.cards c on c.id = r.card_id
      join public.profiles p on p.id = r.requester_id
      where r.event_id = p_event_id and r.status = 'active'));
end;
$$;

-- bot_* RPCs: worker ----------------------------------------------------------------------

-- Everything renderEventPost() needs, or null for a deleted or missing event.
create function public.bot_render_event(p_event_id uuid)
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
    -- Join order, as on the Going tab.
    'going', (
      select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(p.display_name, 'Someone'), 'requests', coalesce(c.n, 0))
        order by a.created_at, a.user_id), '[]'::jsonb)
      from public.attendances a
      join public.profiles p on p.id = a.user_id
      left join counts c on c.requester_id = a.user_id
      where a.event_id = e.id),
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

-- Claims due outbox rows for two minutes (concurrent workers skip each other's).
create function public.bot_claim_outbox(p_limit int default 20)
returns setof public.discord_outbox
language sql
security definer
set search_path = ''
as $$
  update public.discord_outbox o
  set claimed_until = now() + interval '2 minutes', attempts = o.attempts + 1
  where o.id in (
    select id from public.discord_outbox
    where processed_at is null and failed_at is null and next_attempt_at <= now()
      and (claimed_until is null or claimed_until < now())
    order by next_attempt_at, id
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked)
  returning o.*;
$$;

create function public.bot_complete_outbox(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discord_outbox set processed_at = now() where id = any (p_ids) and processed_at is null;
$$;

-- A failed attempt: retry after p_retry_seconds (Discord's retry_after or a
-- backoff), or give up. A retried row stays claimed until then, so it never
-- collides with a newer pending row for the same event.
create function public.bot_fail_outbox(p_id bigint, p_error text, p_retry_seconds numeric, p_give_up boolean default false)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discord_outbox
  set last_error = left(p_error, 500),
      failed_at = case when p_give_up or attempts >= 8 then now() end,
      claimed_until = now() + make_interval(secs => greatest(coalesce(p_retry_seconds, 1), 1)),
      next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_retry_seconds, 1), 1))
  where id = p_id and processed_at is null;
$$;

-- Pruning ------------------------------------------------------------------------------------

create function public.prune_discord_queues()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox int;
  v_dms int;
begin
  delete from public.discord_outbox
  where (processed_at is not null or failed_at is not null) and created_at < now() - interval '7 days';
  get diagnostics v_outbox = row_count;
  delete from public.discord_dm_queue
  where (sent_at is not null or dropped_reason is not null) and created_at < now() - interval '7 days';
  get diagnostics v_dms = row_count;
  return v_outbox + v_dms;
end;
$$;

select cron.schedule('prune-discord-queues', '30 4 * * *', 'select public.prune_discord_queues()');

-- Grants (see *_explicit_api_grants.sql) ------------------------------------------------------
-- Tables: service_role only, plus players reading their own DM status. The
-- revoke makes local Supabase (which auto-grants new tables) match production.

revoke all on table
  public.discord_guild_stores, public.discord_event_posts, public.discord_outbox,
  public.discord_dm_queue, public.discord_dm_status
from public, anon, authenticated;
revoke all on sequence public.discord_outbox_id_seq, public.discord_dm_queue_id_seq from public, anon, authenticated;

grant all on table
  public.discord_guild_stores, public.discord_event_posts, public.discord_outbox,
  public.discord_dm_queue, public.discord_dm_status
to service_role;
grant usage, select on sequence public.discord_outbox_id_seq, public.discord_dm_queue_id_seq to service_role;
grant select on public.discord_dm_status to authenticated;

-- Functions: internal helpers and bot_* RPCs are service_role only.
revoke execute on function
  public.user_for_discord(text),
  public.discord_id_for_user(uuid),
  public.bot_resolve(text),
  public.queue_discord_sync(uuid[], text, interval),
  public.queue_discord_delete(uuid),
  public.discord_child_changes(),
  public.discord_event_changes(),
  public.discord_event_deleted(),
  public.discord_store_changes(),
  public.discord_post_at(date, smallint, time, text),
  public.discord_link_for(text, uuid),
  public.bot_search_stores(text),
  public.bot_link_store(text, text, text, uuid),
  public.bot_update_settings(text, text, uuid, int, time, text),
  public.bot_unlink_store(text, text, uuid, boolean),
  public.bot_status(text),
  public.bot_attend(text, uuid),
  public.bot_leave(text, uuid, boolean),
  public.bot_event_requests(text, uuid),
  public.bot_render_event(uuid),
  public.bot_claim_outbox(int),
  public.bot_complete_outbox(bigint[]),
  public.bot_fail_outbox(bigint, text, numeric, boolean),
  public.prune_discord_queues()
from public, anon, authenticated;

grant execute on function
  public.user_for_discord(text),
  public.discord_id_for_user(uuid),
  public.bot_resolve(text),
  public.queue_discord_sync(uuid[], text, interval),
  public.queue_discord_delete(uuid),
  public.discord_post_at(date, smallint, time, text),
  public.discord_link_for(text, uuid),
  public.bot_search_stores(text),
  public.bot_link_store(text, text, text, uuid),
  public.bot_update_settings(text, text, uuid, int, time, text),
  public.bot_unlink_store(text, text, uuid, boolean),
  public.bot_status(text),
  public.bot_attend(text, uuid),
  public.bot_leave(text, uuid, boolean),
  public.bot_event_requests(text, uuid),
  public.bot_render_event(uuid),
  public.bot_claim_outbox(int),
  public.bot_complete_outbox(bigint[]),
  public.bot_fail_outbox(bigint, text, numeric, boolean),
  public.prune_discord_queues()
to service_role;
