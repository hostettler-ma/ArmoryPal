-- Leaving an event releases everything the user promised to bring for it, so
-- those cards go back to being needed. (Their own requests are kept; Phase 5
-- adds the option to cancel them and notifies affected users.)

create or replace function public.leave_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform public.assert_event_open(p_event_id);
  delete from public.pledges where event_id = p_event_id and pledger_id = auth.uid();
  delete from public.attendances where event_id = p_event_id and user_id = auth.uid();
end;
$$;
