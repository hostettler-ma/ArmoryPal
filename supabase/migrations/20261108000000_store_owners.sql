-- Store owners: players who run a store's Armory can manage it in the app.
-- A player asks for ownership (request_store_ownership); an admin approves or
-- rejects it. Owners are checked with can_manage_store() in owner RPCs.
-- Every write goes through the functions below; there are no write policies.

-- Tables -------------------------------------------------------------------

create table public.store_owners (
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index store_owners_user_id on public.store_owners (user_id);

create table public.store_owner_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text check (char_length(message) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 200),
  created_at timestamptz not null default now()
);

-- One open request per player per store.
create unique index store_owner_requests_one_pending
  on public.store_owner_requests (store_id, user_id) where status = 'pending';
create index store_owner_requests_pending on public.store_owner_requests (created_at) where status = 'pending';

alter table public.store_owners enable row level security;
alter table public.store_owner_requests enable row level security;

-- Who runs a store is public to signed-in players ("Run by …").
create policy "store owners are readable by signed-in users"
  on public.store_owners for select to authenticated using (true);

create policy "users read their own ownership requests"
  on public.store_owner_requests for select to authenticated using (user_id = auth.uid());
create policy "admins read all ownership requests"
  on public.store_owner_requests for select to authenticated using (public.is_admin());

-- Admin log and notification kinds ------------------------------------------

alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check
  check (action in ('remove_attendee', 'ban', 'unban', 'archive_store', 'restore_store', 'delete_store',
                    'approve_owner', 'reject_owner', 'remove_owner'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('pledge_released', 'request_cancelled', 'requests_filled', 'new_requests', 'removed_from_event',
                  'card_needed_again', 'ownership_decided'));

-- Helpers ------------------------------------------------------------------

-- Does the caller own this store? Callable by signed-in users (it only answers
-- about the caller).
create function public.is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.store_owners where store_id = p_store_id and user_id = auth.uid())
    and not public.is_banned();
$$;

-- Admins manage every store; owners manage theirs.
create function public.can_manage_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.is_store_owner(p_store_id);
$$;

-- Internal: raises unless the caller can manage the store.
create function public.assert_can_manage(p_store_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if public.is_banned() then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not public.can_manage_store(p_store_id) then
    raise exception 'not_store_owner' using errcode = '42501';
  end if;
end;
$$;

-- RPCs ---------------------------------------------------------------------

create function public.request_store_ownership(p_store_id uuid, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if public.is_banned() then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id and archived_at is null) then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;
  if char_length(v_message) > 200 then
    raise exception 'message_too_long' using errcode = '22023';
  end if;
  if exists (select 1 from public.store_owners where store_id = p_store_id and user_id = auth.uid()) then
    raise exception 'already_owner' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.store_owner_requests
             where store_id = p_store_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'request_pending' using errcode = 'P0001';
  end if;

  insert into public.store_owner_requests (store_id, user_id, message)
  values (p_store_id, auth.uid(), v_message)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.cancel_ownership_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.store_owner_requests set status = 'cancelled', decided_at = now()
  where id = p_request_id and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'ownership_request_not_found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.admin_decide_ownership_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.store_owner_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_store text;
begin
  perform public.assert_admin();
  if char_length(v_note) > 200 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  select * into req from public.store_owner_requests where id = p_request_id for update;
  if not found or req.status <> 'pending' then
    raise exception 'ownership_request_not_found' using errcode = 'P0002';
  end if;
  if p_approve and exists (select 1 from public.bans where user_id = req.user_id) then
    raise exception 'banned' using errcode = 'P0001';
  end if;

  update public.store_owner_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = v_note
  where id = p_request_id;

  if p_approve then
    insert into public.store_owners (store_id, user_id, granted_by)
    values (req.store_id, req.user_id, auth.uid())
    on conflict do nothing;
  end if;

  select name into v_store from public.stores where id = req.store_id;
  perform public.notify(req.user_id, null, 'ownership_decided', jsonb_strip_nulls(jsonb_build_object(
    'approved', p_approve, 'store', v_store, 'store_id', req.store_id, 'note', v_note)));
  perform public.log_admin_action(case when p_approve then 'approve_owner' else 'reject_owner' end,
    req.user_id, req.store_id, null,
    (select display_name from public.profiles where id = req.user_id) || ' · ' || v_store, v_note);
end;
$$;

create function public.admin_remove_store_owner(p_store_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  delete from public.store_owners where store_id = p_store_id and user_id = p_user_id;
  if not found then
    raise exception 'not_store_owner' using errcode = 'P0001';
  end if;
  perform public.log_admin_action('remove_owner', p_user_id, p_store_id, null,
    (select display_name from public.profiles where id = p_user_id) || ' · '
      || (select name from public.stores where id = p_store_id), null);
end;
$$;

-- A ban also ends the player's store ownerships and open requests.
create function public.bans_revoke_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.store_owners where user_id = new.user_id;
  update public.store_owner_requests set status = 'rejected', decided_at = now(), decided_by = new.banned_by
  where user_id = new.user_id and status = 'pending';
  return new;
end;
$$;

create trigger bans_revoke_ownership after insert on public.bans
  for each row execute function public.bans_revoke_ownership();

-- Grants (see *_explicit_api_grants.sql) -------------------------------------

grant select on public.store_owners, public.store_owner_requests to authenticated;
grant all on public.store_owners, public.store_owner_requests to service_role;

revoke execute on function
  public.is_store_owner(uuid),
  public.can_manage_store(uuid),
  public.assert_can_manage(uuid),
  public.request_store_ownership(uuid, text),
  public.cancel_ownership_request(uuid),
  public.admin_decide_ownership_request(uuid, boolean, text),
  public.admin_remove_store_owner(uuid, uuid),
  public.bans_revoke_ownership()
from public, anon;

-- Internal helpers: not callable through the API.
revoke execute on function public.assert_can_manage(uuid), public.bans_revoke_ownership() from authenticated;

grant execute on function
  public.is_store_owner(uuid),
  public.can_manage_store(uuid),
  public.request_store_ownership(uuid, text),
  public.cancel_ownership_request(uuid),
  public.admin_decide_ownership_request(uuid, boolean, text),
  public.admin_remove_store_owner(uuid, uuid)
to authenticated;

grant execute on function
  public.is_store_owner(uuid),
  public.can_manage_store(uuid),
  public.assert_can_manage(uuid),
  public.request_store_ownership(uuid, text),
  public.cancel_ownership_request(uuid),
  public.admin_decide_ownership_request(uuid, boolean, text),
  public.admin_remove_store_owner(uuid, uuid),
  public.bans_revoke_ownership()
to service_role;
