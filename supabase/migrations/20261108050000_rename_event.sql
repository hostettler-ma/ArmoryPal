-- Owners and admins rename an event ("Armory" → "Holiday Armory"). Renaming
-- the weekly slot still renames its open events, except ones renamed by hand.

create function public.owner_rename_event(p_event_id uuid, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events := public.assert_event_open(p_event_id);
begin
  perform public.assert_can_manage(ev.store_id);
  perform public.assert_valid_label(p_label);
  update public.events set label = btrim(p_label) where id = p_event_id;
end;
$$;

-- Same as before (*_event_management.sql), but only events still carrying the
-- slot's old name take the new one.
create or replace function public.owner_update_schedule(
  p_schedule_id uuid, p_label text, p_weekday smallint, p_start_time time)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sch public.store_schedules;
  v_tz text;
  v_shift int;
  v_label text := btrim(p_label);
  e record;
  t record;
begin
  select * into sch from public.store_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_can_manage(sch.store_id);
  perform public.assert_valid_label(p_label);
  if p_weekday not between 0 and 6 or p_start_time is null then
    raise exception 'invalid_schedule' using errcode = '22023';
  end if;
  select timezone into v_tz from public.stores where id = sch.store_id;

  -- Days from the old weekday's current occurrence to the new one's (-6..6).
  select (n.event_date - o.event_date) into v_shift
  from public.event_occurrence(sch.weekday, sch.start_time, v_tz) o,
       public.event_occurrence(p_weekday, p_start_time, v_tz) n;

  update public.store_schedules
  set label = v_label, weekday = p_weekday, start_time = p_start_time
  where id = p_schedule_id;

  for e in
    select * from public.events
    where schedule_id = p_schedule_id and ends_at > now()
    order by slot_date
    for update
  loop
    if e.moved_from is null then
      select * into t from public.event_times(e.slot_date + v_shift, p_start_time, v_tz);
      update public.events
      set slot_date = e.slot_date + v_shift, event_date = e.slot_date + v_shift,
          starts_at = t.starts_at, ends_at = t.ends_at,
          label = case when e.label = sch.label then v_label else e.label end
      where id = e.id;
      perform public.announce_event_moved(e.id, e.starts_at);
    else
      update public.events
      set slot_date = e.slot_date + v_shift,
          label = case when e.label = sch.label then v_label else e.label end
      where id = e.id;
    end if;
  end loop;
end;
$$;

-- Grants (see *_explicit_api_grants.sql). The replaced function keeps its own.
revoke execute on function public.owner_rename_event(uuid, text) from public, anon;
grant execute on function public.owner_rename_event(uuid, text) to authenticated, service_role;
