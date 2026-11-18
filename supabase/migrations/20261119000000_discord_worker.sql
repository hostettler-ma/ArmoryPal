-- ArmoryBot Phase 3 (docs/armorybot.md §5): scheduled posting, the worker's
-- bookkeeping RPCs, and waking the discord-worker Edge Function.
--
-- The worker is woken two ways, both through pg_net with the URL and shared
-- secret from Vault (names 'discord_worker_url', 'discord_worker_secret'):
--   * pg_cron every minute (scheduled posts, retries, the 10-minute reconcile);
--   * right after outbox rows are queued (throttled to one call per 2 seconds).
-- Without those Vault secrets (CI, a fresh local stack) nothing is called.

create extension if not exists pg_net;

-- Waking the worker -----------------------------------------------------------------------

-- One row: when the outbox trigger last woke the worker (throttling), and an
-- optional pause. Pausing stops waking the worker and stops it claiming work:
--   update public.discord_worker_state set paused_until = 'infinity';   -- until resumed (set null)
-- The DB tests pause it for a minute or two so a running local worker never
-- picks up their test rows; it expires on its own if a test run crashes.
create table public.discord_worker_state (
  id int primary key default 1 check (id = 1),
  last_kick_at timestamptz not null default '-infinity',
  paused_until timestamptz
);
insert into public.discord_worker_state default values;
alter table public.discord_worker_state enable row level security;

-- Calls the worker (fire-and-forget; pg_net sends after commit). With
-- p_throttle, at most once per 2 seconds, and never waiting on another
-- transaction's lock (skip locked), so player writes are never slowed down.
create function public.discord_worker_paused()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select paused_until > now() from public.discord_worker_state where id = 1), false);
$$;

create function public.kick_discord_worker(p_throttle boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if public.discord_worker_paused() then
    return;
  end if;
  if p_throttle then
    perform 1 from public.discord_worker_state
    where id = 1 and last_kick_at < now() - interval '2 seconds'
    for update skip locked;
    if not found then
      return;
    end if;
    update public.discord_worker_state set last_kick_at = now() where id = 1;
  end if;

  -- Whitespace never belongs in either (a pasted line break would make the URL invalid).
  select regexp_replace(decrypted_secret, '\s', '', 'g') into v_url from vault.decrypted_secrets where name = 'discord_worker_url';
  select regexp_replace(decrypted_secret, '\s', '', 'g') into v_secret from vault.decrypted_secrets where name = 'discord_worker_secret';
  if v_url is null or v_secret is null or v_url = '' or v_secret = '' then
    return;
  end if;

  -- This runs inside players' writes (the outbox trigger): a bad setting must
  -- never make attending or requesting fail. Log it and carry on.
  begin
    perform net.http_post(
      url := v_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      -- The worker runs for up to ~50 s; don't hang up on it.
      timeout_milliseconds := 60000
    );
  exception when others then
    raise warning 'kick_discord_worker: %', sqlerrm;
  end;
end;
$$;

create function public.discord_outbox_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ON CONFLICT DO NOTHING still fires statement triggers: only kick for real rows.
  if exists (select 1 from new_rows) then
    perform public.kick_discord_worker(true);
  end if;
  return null;
end;
$$;

create trigger discord_outbox_kick after insert on public.discord_outbox
  referencing new table as new_rows for each statement execute function public.discord_outbox_kick();

-- Scheduled posting -----------------------------------------------------------------------

-- Posts that are due: every (server, event) whose post time has come, for
-- linked, working channels, not yet posted there. Claims them by inserting
-- the post row (message_id null); claims the worker never completed are
-- handed out again after 5 minutes. Makes sure this week's events exist first.
-- p_guild_id limits it to one server (tests use it so they never claim real posts).
create function public.bot_due_posts(p_limit int default 10, p_guild_id text default null)
returns setof public.discord_event_posts
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_guild_id is null and public.discord_worker_paused() then
    return;
  end if;
  perform public.ensure_current_events(array(
    select distinct l.store_id from public.discord_guild_stores l
    where l.broken_at is null and (p_guild_id is null or l.guild_id = p_guild_id)));

  return query
  with stale as (
    update public.discord_event_posts p
    set created_at = now()
    where p.message_id is null and p.gone_at is null and p.created_at < now() - interval '5 minutes'
      and (p_guild_id is null or p.guild_id = p_guild_id)
    returning p.*
  ),
  due as (
    insert into public.discord_event_posts (guild_id, event_id, channel_id)
    select l.guild_id, e.id, l.channel_id
    from public.discord_guild_stores l
    join public.stores s on s.id = l.store_id
    join public.events e on e.store_id = l.store_id
    left join public.store_schedules sch on sch.id = e.schedule_id
    where l.broken_at is null
      and (p_guild_id is null or l.guild_id = p_guild_id)
      and s.archived_at is null
      and e.deleted_at is null
      and e.ends_at > now()
      and (e.schedule_id is null or sch.active)
      and now() >= public.discord_post_at(e.event_date, l.days_before, l.post_time, s.timezone)
      and not exists (select 1 from public.discord_event_posts p where p.guild_id = l.guild_id and p.event_id = e.id)
    order by e.starts_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    on conflict do nothing
    returning *
  )
  select * from stale
  union all
  select * from due;
end;
$$;

-- The post went out. Returns false if the event was deleted meanwhile (the
-- worker then deletes the message it just sent).
create function public.bot_record_post(p_guild_id text, p_event_id uuid, p_message_id text, p_render_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.discord_event_posts
  set message_id = p_message_id, posted_at = now(), last_rendered_at = now(), render_hash = p_render_hash
  where guild_id = p_guild_id and event_id = p_event_id;
  return exists (select 1 from public.events where id = p_event_id and deleted_at is null);
end;
$$;

-- Posting failed for good (e.g. no access): drop the claim so it's retried
-- once the channel is fixed.
create function public.bot_release_post(p_guild_id text, p_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.discord_event_posts
  where guild_id = p_guild_id and event_id = p_event_id and message_id is null;
$$;

-- Same as *_armorybot.sql, but claims nothing while paused (unless the caller,
-- a test, says to ignore the pause).
drop function public.bot_claim_outbox(int);
create function public.bot_claim_outbox(p_limit int default 20, p_ignore_pause boolean default false)
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
      and (p_ignore_pause or not public.discord_worker_paused())
    order by next_attempt_at, id
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked)
  returning o.*;
$$;

-- Editing --------------------------------------------------------------------------------

-- An event's live posts, and whether each server still links the store
-- (unlinked posts get a last render with the buttons off).
create function public.bot_post_targets(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'guild_id', p.guild_id, 'channel_id', p.channel_id, 'message_id', p.message_id, 'render_hash', p.render_hash,
    'linked', exists (
      select 1 from public.discord_guild_stores l join public.events e on e.store_id = l.store_id
      where l.guild_id = p.guild_id and e.id = p.event_id),
    -- Discord already refused this channel: skip it until the link is fixed.
    'broken', exists (
      select 1 from public.discord_guild_stores l join public.events e on e.store_id = l.store_id
      where l.guild_id = p.guild_id and e.id = p.event_id and l.broken_at is not null))
    order by p.guild_id), '[]'::jsonb)
  from public.discord_event_posts p
  where p.event_id = p_event_id and p.message_id is not null and p.gone_at is null and p.finalized_at is null;
$$;

-- A post was (re)rendered. p_finalize: the last render (event over, or unlinked).
create function public.bot_record_render(p_guild_id text, p_event_id uuid, p_render_hash text, p_finalize boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discord_event_posts
  set render_hash = p_render_hash, last_rendered_at = now(),
      finalized_at = case when p_finalize then now() else finalized_at end
  where guild_id = p_guild_id and event_id = p_event_id;
$$;

-- The message is gone (deleted by a moderator, or by us). Never reposted.
create function public.bot_post_gone(p_guild_id text, p_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discord_event_posts set gone_at = coalesce(gone_at, now())
  where guild_id = p_guild_id and event_id = p_event_id;
$$;

-- Discord says the channel or server is gone, or the bot lost access. With no
-- channel: every link in that server. Linking again or picking a channel
-- with /armory settings clears it.
create function public.bot_mark_broken(p_guild_id text, p_channel_id text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discord_guild_stores
  set broken_at = now(), broken_reason = left(p_reason, 200)
  where guild_id = p_guild_id and (p_channel_id is null or channel_id = p_channel_id) and broken_at is null;
$$;

-- Seconds until the next outbox row is due (null if none), so the worker can
-- wait a moment for a debounced refresh instead of exiting.
create function public.bot_next_outbox_in()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  -- Null (not 0) when nothing is pending: greatest() would turn a null min() into 0.
  select case when min(t) is null then null else greatest(extract(epoch from min(t) - now()), 0) end
  from (select greatest(next_attempt_at, coalesce(claimed_until, next_attempt_at)) as t
        from public.discord_outbox
        where processed_at is null and failed_at is null and not public.discord_worker_paused()) pending;
$$;

-- Reconcile -------------------------------------------------------------------------------

-- Every 10 minutes: re-render every live post (catching anything a trigger
-- missed, display-name changes, and events that just ended, which get their
-- final render). Unchanged posts cost nothing: the worker compares render hashes.
create function public.queue_discord_reconcile()
returns void
language sql
security definer
set search_path = ''
as $$
  select public.queue_discord_sync(array(
    select distinct event_id from public.discord_event_posts
    where message_id is not null and gone_at is null and finalized_at is null), 'refresh', interval '0 seconds');
$$;

select cron.schedule('discord-worker', '* * * * *', 'select public.kick_discord_worker(false)');
select cron.schedule('discord-reconcile', '*/10 * * * *', 'select public.queue_discord_reconcile()');

-- Grants (see *_explicit_api_grants.sql): service_role only ------------------------------------

revoke all on table public.discord_worker_state from public, anon, authenticated;
grant all on table public.discord_worker_state to service_role;

revoke execute on function
  public.discord_worker_paused(),
  public.bot_claim_outbox(int, boolean),
  public.kick_discord_worker(boolean),
  public.discord_outbox_kick(),
  public.bot_due_posts(int, text),
  public.bot_record_post(text, uuid, text, text),
  public.bot_release_post(text, uuid),
  public.bot_post_targets(uuid),
  public.bot_record_render(text, uuid, text, boolean),
  public.bot_post_gone(text, uuid),
  public.bot_mark_broken(text, text, text),
  public.bot_next_outbox_in(),
  public.queue_discord_reconcile()
from public, anon, authenticated;

grant execute on function
  public.discord_worker_paused(),
  public.bot_claim_outbox(int, boolean),
  public.kick_discord_worker(boolean),
  public.bot_due_posts(int, text),
  public.bot_record_post(text, uuid, text, text),
  public.bot_release_post(text, uuid),
  public.bot_post_targets(uuid),
  public.bot_record_render(text, uuid, text, boolean),
  public.bot_post_gone(text, uuid),
  public.bot_mark_broken(text, text, text),
  public.bot_next_outbox_in(),
  public.queue_discord_reconcile()
to service_role;
