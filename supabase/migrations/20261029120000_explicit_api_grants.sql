-- Explicit Data API grants. Local Supabase auto-grants the API roles access to
-- new tables/functions; cloud projects created with "automatically expose new
-- tables" off don't, which surfaced as "permission denied" in production. State
-- every privilege the app needs instead of relying on project defaults.
-- RLS still decides *which rows*; these grants decide *which operations*.
-- New tables/functions must add their grants here-style in their own migration.

grant usage on schema public to anon, authenticated, service_role;

-- service_role (secret key: import/admin scripts). Bypasses RLS by design.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- authenticated: read what RLS allows…
grant select on
  public.profiles, public.stores, public.store_schedules, public.user_stores,
  public.events, public.attendances, public.cards, public.catalog_meta,
  public.requests, public.pledges, public.notifications, public.notification_preferences
to authenticated;

-- …and only the direct writes the app performs (everything else goes through RPCs).
grant update (display_name, gem_id) on public.profiles to authenticated;
grant insert, update, delete on public.stores, public.store_schedules to authenticated; -- admins only (RLS)
grant insert, delete on public.user_stores to authenticated;
grant insert, update on public.notification_preferences to authenticated;

-- RPCs and helpers called with the user's own privileges (invoker functions,
-- RLS policies, check constraints).
grant execute on function
  public.search_stores(text),
  public.search_cards(text, int),
  public.event_occurrence(smallint, time, text, timestamptz),
  public.current_events_for_stores(uuid[]),
  public.attend_event(uuid),
  public.leave_event(uuid, boolean),
  public.add_requests(uuid, jsonb, text),
  public.update_request(uuid, int, text),
  public.cancel_request(uuid),
  public.pledge(uuid, int),
  public.unpledge(uuid),
  public.mark_notifications_read(),
  public.copy_open_requests(uuid, uuid),
  public.resolve_card_names(text[]),
  public.card_name_key(text),
  public.is_admin(),
  public.is_valid_timezone(text)
to authenticated;

-- anon (signed-out) gets no table or function access: every page requires sign-in.
