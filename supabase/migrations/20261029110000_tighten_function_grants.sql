-- Pre-launch least-privilege pass. None of these were exploitable (trigger
-- functions can't be called directly; is_admin() is false for anon), but no
-- client role needs to call them. Trigger functions keep firing: EXECUTE is
-- only checked when a trigger is created, not when it runs.

revoke execute on function public.broadcast_event_changes() from public, anon, authenticated;
revoke execute on function public.broadcast_notification() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- RLS policies (to authenticated) call is_admin(), so signed-in users keep it.
revoke execute on function public.is_admin() from public, anon;
