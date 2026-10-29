-- Card requests ("I need") and pledges ("I'll bring it") for an event.
-- All writes go through the security-definer functions below; the tables have
-- no write policies. Rules are mirrored in src/lib/rules.ts.
--
-- Errors are raised with a short machine-readable code as the message
-- (e.g. 'not_attending'), which the UI maps to friendly text.

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  card_id text not null references public.cards (id) on delete restrict,
  quantity int not null check (quantity between 1 and 20),
  note text check (char_length(note) <= 200),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  copied_from_id uuid references public.requests (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index requests_event_id on public.requests (event_id);
create index requests_requester_id on public.requests (requester_id);
-- One active request per user per card per event; asking again adds to it.
create unique index requests_one_active_per_card
  on public.requests (event_id, requester_id, card_id) where status = 'active';

create table public.pledges (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade, -- denormalized for realtime filters
  pledger_id uuid not null references public.profiles (id) on delete cascade,
  quantity int not null check (quantity between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, pledger_id)
);

create index pledges_event_id on public.pledges (event_id);
create index pledges_pledger_id on public.pledges (pledger_id);

alter table public.requests enable row level security;
alter table public.pledges enable row level security;

create policy "requests are readable by signed-in users"
  on public.requests for select to authenticated using (true);
create policy "pledges are readable by signed-in users"
  on public.pledges for select to authenticated using (true);

-- Helpers ------------------------------------------------------------------

-- Same behavior as before, but with the 'event_ended' code as the message.
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

create function public.assert_attending(p_event_id uuid)
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
  if not exists (
    select 1 from public.attendances where event_id = p_event_id and user_id = auth.uid()
  ) then
    raise exception 'not_attending' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.assert_attending(uuid) from public, anon, authenticated;

-- Requests -----------------------------------------------------------------

-- Adds one request per item ({card_id, quantity}). If the user already has an
-- active request for a card, the quantity is added to it (capped at 20).
create function public.add_requests(p_event_id uuid, p_items jsonb, p_note text default null)
returns setof public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_note text := nullif(btrim(p_note), '');
begin
  perform public.assert_event_open(p_event_id);
  perform public.assert_attending(p_event_id);

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    if coalesce((item ->> 'quantity')::int, 0) not between 1 and 20 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.cards where id = item ->> 'card_id') then
      raise exception 'card_not_found' using errcode = 'P0001';
    end if;

    return query
    insert into public.requests as r (event_id, requester_id, card_id, quantity, note)
    values (p_event_id, auth.uid(), item ->> 'card_id', (item ->> 'quantity')::int, v_note)
    on conflict (event_id, requester_id, card_id) where status = 'active'
    do update set
      quantity = least(r.quantity + excluded.quantity, 20),
      note = coalesce(excluded.note, r.note),
      updated_at = now()
    returning *;
  end loop;
end;
$$;

-- Lock and return a request the caller owns, on an open event.
create function public.lock_own_request(p_request_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into req from public.requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if req.requester_id <> auth.uid() then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  if req.status <> 'active' then
    raise exception 'request_cancelled' using errcode = 'P0001';
  end if;
  perform public.assert_event_open(req.event_id);
  return req;
end;
$$;

revoke execute on function public.lock_own_request(uuid) from public, anon, authenticated;

create function public.update_request(p_request_id uuid, p_quantity int, p_note text default null)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  v_pledged int;
  v_note text := nullif(btrim(p_note), '');
begin
  req := public.lock_own_request(p_request_id);
  if p_quantity not between 1 and 20 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;
  select coalesce(sum(quantity), 0) into v_pledged from public.pledges where request_id = p_request_id;
  if p_quantity < v_pledged then
    raise exception 'below_pledged' using errcode = 'P0001';
  end if;

  update public.requests
  set quantity = p_quantity, note = v_note, updated_at = now()
  where id = p_request_id
  returning * into req;
  return req;
end;
$$;

-- Cancels the request and removes its pledges.
-- Phase 5 adds notifications to the affected pledgers.
create function public.cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_own_request(p_request_id);
  delete from public.pledges where request_id = p_request_id;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_request_id;
end;
$$;

-- Pledges ------------------------------------------------------------------

-- Creates or updates the caller's pledge. The request row is locked so
-- concurrent pledges can't exceed the requested quantity.
create function public.pledge(p_request_id uuid, p_quantity int)
returns public.pledges
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  v_others int;
  result public.pledges;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into req from public.requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_event_open(req.event_id);
  perform public.assert_attending(req.event_id);
  if req.status <> 'active' then
    raise exception 'request_cancelled' using errcode = 'P0001';
  end if;
  if req.requester_id = auth.uid() then
    raise exception 'own_request' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;

  select coalesce(sum(quantity), 0) into v_others
  from public.pledges
  where request_id = p_request_id and pledger_id <> auth.uid();
  if p_quantity > req.quantity - v_others then
    raise exception 'exceeds_remaining' using errcode = 'P0001';
  end if;

  insert into public.pledges (request_id, event_id, pledger_id, quantity)
  values (p_request_id, req.event_id, auth.uid(), p_quantity)
  on conflict (request_id, pledger_id)
  do update set quantity = excluded.quantity, updated_at = now()
  returning * into result;
  return result;
end;
$$;

create function public.unpledge(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select event_id into v_event_id from public.requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_event_open(v_event_id);
  delete from public.pledges where request_id = p_request_id and pledger_id = auth.uid();
end;
$$;

revoke execute on function public.add_requests(uuid, jsonb, text) from public, anon;
revoke execute on function public.update_request(uuid, int, text) from public, anon;
revoke execute on function public.cancel_request(uuid) from public, anon;
revoke execute on function public.pledge(uuid, int) from public, anon;
revoke execute on function public.unpledge(uuid) from public, anon;
