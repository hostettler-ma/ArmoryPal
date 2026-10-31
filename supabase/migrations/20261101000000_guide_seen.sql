-- Getting-started guide: pops up once per account, after onboarding.
alter table public.profiles add column guide_seen_at timestamptz;

-- Existing players have found their way already; only new accounts see the pop-up.
update public.profiles set guide_seen_at = now();

-- Players mark their own guide as seen (the own-row, not-banned update policy applies).
grant update (display_name, gem_id, guide_seen_at) on public.profiles to authenticated;
