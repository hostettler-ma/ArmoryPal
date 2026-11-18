-- ArmoryBot Phase 4 (docs/armorybot.md §6): Discord DMs for 'new_requests' and
-- 'card_needed_again'. notify() already queues one discord_dm_queue row per
-- recipient (opted in, Discord linked, not paused; *_armorybot.sql). Here the
-- worker claims them per player once the oldest has waited 2 minutes, sends one
-- DM per player, and records the outcome.

alter table public.discord_dm_queue add column attempts int not null default 0;

-- How many times a DM is tried (rate limits, Discord outages) before giving up.
create function public.dm_max_attempts()
returns int
language sql
immutable
set search_path = ''
as $$ select 5 $$;

-- Claims due DM batches: every player whose oldest pending DM is past its
-- 2-minute window, with all their pending DMs (so one DM covers them all).
-- First drops what must not go out anymore: Discord disconnected or changed,
-- DMs turned off, the player banned or paused (Discord refused a DM in the
-- last 24 h), the event deleted, cancelled or over, or too many attempts.
-- p_user_id limits it to one player (tests); unscoped calls do nothing while
-- the worker is paused.
create function public.bot_claim_dm_batches(p_limit int default 10, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
  v_result jsonb;
begin
  if p_user_id is null and public.discord_worker_paused() then
    return '[]'::jsonb;
  end if;

  with pending as (
    select q.id,
      case
        when public.discord_id_for_user(q.user_id) is distinct from q.discord_id::text then 'discord_disconnected'
        when not exists (
          select 1 from public.notification_preferences np
          where np.user_id = q.user_id and np.kind = q.kind and np.channel = 'discord' and np.enabled) then 'turned_off'
        when public.is_user_banned(q.user_id) then 'banned'
        when exists (
          select 1 from public.discord_dm_status s
          where s.user_id = q.user_id and s.undeliverable_at > now() - interval '24 hours') then 'undeliverable'
        when e.deleted_at is not null or e.cancelled_at is not null or e.ends_at <= now() then 'event_over'
        when q.attempts >= public.dm_max_attempts() then 'gave_up'
      end as reason
    from public.discord_dm_queue q
    join public.events e on e.id = q.event_id
    where q.sent_at is null and q.dropped_reason is null
      and (q.claimed_until is null or q.claimed_until < now())
      and (p_user_id is null or q.user_id = p_user_id)
  )
  update public.discord_dm_queue q set dropped_reason = p.reason
  from pending p
  where p.id = q.id and p.reason is not null;

  select array_agg(user_id) into v_users from (
    select user_id
    from public.discord_dm_queue
    where sent_at is null and dropped_reason is null
      and (claimed_until is null or claimed_until < now())
      and (p_user_id is null or user_id = p_user_id)
    group by user_id
    having min(send_after) <= now()
    order by min(send_after)
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
  ) due;

  if v_users is null then
    return '[]'::jsonb;
  end if;

  with claimed as (
    update public.discord_dm_queue q
    set claimed_until = now() + interval '2 minutes', attempts = q.attempts + 1
    where q.id in (
      select id from public.discord_dm_queue
      where user_id = any (v_users) and sent_at is null and dropped_reason is null
        and (claimed_until is null or claimed_until < now())
      for update skip locked)
    returning q.*
  ),
  batches as (
    select c.user_id,
      (array_agg(c.discord_id::text order by c.created_at desc))[1] as discord_id,
      jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'payload', c.payload, 'created_at', c.created_at,
        'event', jsonb_build_object('id', e.id, 'label', e.label, 'starts_at', e.starts_at, 'store', s.name))
        order by e.starts_at, e.id, c.created_at, c.id) as items
    from claimed c
    join public.events e on e.id = c.event_id
    join public.stores s on s.id = e.store_id
    group by c.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', b.user_id, 'discord_id', b.discord_id, 'items', b.items)), '[]'::jsonb)
  into v_result
  from batches b;

  return v_result;
end;
$$;

-- The DM went out: mark the rows sent, and clear any "can't DM you" status.
create function public.bot_complete_dm_batch(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discord_dm_queue set sent_at = now() where id = any (p_ids) and sent_at is null;
  delete from public.discord_dm_status
  where user_id in (select user_id from public.discord_dm_queue where id = any (p_ids));
$$;

-- Discord won't let ArmoryBot DM this player (50007: privacy settings or a
-- block; 50278: no server in common). Drop the rows (never retried) and pause
-- their DMs for 24 hours; /settings/notifications explains why.
create function public.bot_dm_undeliverable(p_ids bigint[], p_code int)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discord_dm_queue set dropped_reason = 'discord_' || p_code where id = any (p_ids) and sent_at is null;
  insert into public.discord_dm_status (user_id, undeliverable_at, error_code)
  select distinct user_id, now(), p_code from public.discord_dm_queue where id = any (p_ids)
  on conflict (user_id) do update set undeliverable_at = excluded.undeliverable_at, error_code = excluded.error_code;
$$;

-- A failed attempt: try again after p_retry_seconds (the rows stay claimed
-- until then), or drop the rows with a reason.
create function public.bot_retry_dm_batch(p_ids bigint[], p_retry_seconds numeric, p_drop_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discord_dm_queue
  set claimed_until = case when p_drop_reason is null
                           then now() + make_interval(secs => greatest(coalesce(p_retry_seconds, 1), 1))
                           else claimed_until end,
      dropped_reason = left(p_drop_reason, 100)
  where id = any (p_ids) and sent_at is null;
$$;

-- Grants (see *_explicit_api_grants.sql): service_role only ------------------------------------

revoke execute on function
  public.dm_max_attempts(),
  public.bot_claim_dm_batches(int, uuid),
  public.bot_complete_dm_batch(bigint[]),
  public.bot_dm_undeliverable(bigint[], int),
  public.bot_retry_dm_batch(bigint[], numeric, text)
from public, anon, authenticated;

grant execute on function
  public.dm_max_attempts(),
  public.bot_claim_dm_batches(int, uuid),
  public.bot_complete_dm_batch(bigint[]),
  public.bot_dm_undeliverable(bigint[], int),
  public.bot_retry_dm_batch(bigint[], numeric, text)
to service_role;
