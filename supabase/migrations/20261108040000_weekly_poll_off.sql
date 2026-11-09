-- Turning weekly polls off now takes them off the slot's upcoming events.
-- Polls remember whether they came from the weekly setting, so turning it off
-- removes only those, and only where nobody has voted yet. One-time polls
-- (owner_open_poll) and polls with votes stay.

alter table public.format_polls add column weekly boolean not null default false;

-- Polls the weekly trigger made so far have no creator.
update public.format_polls set weekly = true where created_by is null;

create or replace function public.events_weekly_poll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.format_polls (event_id, options, weekly)
  select new.id, sch.poll_options, true
  from public.store_schedules sch
  where sch.id = new.schedule_id and sch.weekly_format_poll
  on conflict do nothing;
  return null;
end;
$$;

create or replace function public.owner_set_weekly_poll(p_schedule_id uuid, p_on boolean, p_options text[])
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
    insert into public.format_polls (event_id, options, created_by, weekly)
    select e.id, p_options, auth.uid(), true
    from public.events e
    where e.schedule_id = p_schedule_id and e.starts_at > now() and e.format is null
    on conflict do nothing;
    -- Open weekly polls nobody voted in yet take the new options.
    update public.format_polls p set options = p_options
    from public.events e
    where e.id = p.event_id and e.schedule_id = p_schedule_id and e.starts_at > now()
      and p.weekly and p.closed_at is null
      and not exists (select 1 from public.format_votes v where v.event_id = p.event_id);
  else
    delete from public.format_polls p
    using public.events e
    where e.id = p.event_id and e.schedule_id = p_schedule_id and e.starts_at > now()
      and p.weekly and p.closed_at is null
      and not exists (select 1 from public.format_votes v where v.event_id = p.event_id);
  end if;
end;
$$;
