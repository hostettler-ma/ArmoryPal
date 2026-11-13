-- Schema upkeep: integrity checks the RPCs already respected, one list per
-- enum-like column, pruning old notifications, and missing indexes.

-- Integrity --------------------------------------------------------------------

-- A pledge's event_id is copied from its request (for realtime). Make the DB
-- guarantee they match.
alter table public.requests add constraint requests_id_event_id_key unique (id, event_id);
alter table public.pledges
  drop constraint pledges_request_id_fkey,
  add constraint pledges_request_event_fkey foreign key (request_id, event_id)
    references public.requests (id, event_id) on delete cascade;

-- A weekly event belongs to its schedule's store. One-off events have a null
-- schedule_id, which a (default MATCH SIMPLE) composite FK doesn't check.
alter table public.store_schedules add constraint store_schedules_id_store_id_key unique (id, store_id);
alter table public.events
  drop constraint events_schedule_id_fkey,
  add constraint events_schedule_store_fkey foreign key (schedule_id, store_id)
    references public.store_schedules (id, store_id) on delete restrict;

-- One list per enum-like column ----------------------------------------------------
-- Adding a value is now one statement pair on the domain:
--   alter domain public.notification_kind drop constraint notification_kind_check;
--   alter domain public.notification_kind add constraint notification_kind_check check (value in (...));
-- (and NOTIFICATION_KINDS in src/lib/notifications.ts).

create domain public.notification_kind as text
  constraint notification_kind_check check (value in (
    'pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
    'card_needed_again', 'ownership_decided', 'event_moved', 'attendee_left',
    'format_poll_opened', 'format_confirmed', 'event_cancelled'));

alter table public.notifications
  drop constraint notifications_kind_check,
  alter column kind type public.notification_kind;
alter table public.notification_preferences
  drop constraint notification_preferences_kind_check,
  alter column kind type public.notification_kind;

create domain public.admin_action as text
  constraint admin_action_check check (value in (
    'remove_attendee', 'ban', 'unban', 'archive_store', 'restore_store', 'delete_store',
    'approve_owner', 'reject_owner', 'remove_owner'));

alter table public.admin_actions
  drop constraint admin_actions_action_check,
  alter column action type public.admin_action;

grant usage on domain public.notification_kind, public.admin_action to authenticated, service_role;

-- Pruning old notifications ---------------------------------------------------------
-- new_requests and card_needed_again go to a whole audience, so this table grows
-- fastest. Read notifications go after 90 days, unread ones after a year.

create function public.prune_notifications()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.notifications
  where (read_at is not null and created_at < now() - interval '90 days')
     or created_at < now() - interval '365 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.prune_notifications() from public, anon, authenticated;
grant execute on function public.prune_notifications() to service_role;

create extension if not exists pg_cron;

-- Daily at 04:00 UTC. cron.schedule() replaces an existing job with the same name.
select cron.schedule('prune-notifications', '0 4 * * *', 'select public.prune_notifications()');

-- Indexes -------------------------------------------------------------------------

-- The bell's unread count.
create index notifications_unread on public.notifications (user_id) where read_at is null;
-- Cascades from events (deleting an event).
create index notifications_event_id on public.notifications (event_id);

-- Cascades and set-nulls from profiles (deleting a user).
create index format_votes_user_id on public.format_votes (user_id);
create index store_owner_requests_user_id on public.store_owner_requests (user_id);
create index stores_created_by on public.stores (created_by) where created_by is not null;
create index bans_banned_by on public.bans (banned_by) where banned_by is not null;
create index admin_actions_admin_id on public.admin_actions (admin_id) where admin_id is not null;
create index store_owners_granted_by on public.store_owners (granted_by) where granted_by is not null;
create index store_owner_requests_decided_by on public.store_owner_requests (decided_by) where decided_by is not null;
create index format_polls_created_by on public.format_polls (created_by) where created_by is not null;
