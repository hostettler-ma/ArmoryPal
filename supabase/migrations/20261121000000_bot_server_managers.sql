-- ArmoryBot: the person running a Discord server is often not the store's owner on
-- ArmoryPal. Anyone with Manage Server in that server can now link a store and change
-- its settings, as they already could unlink it. They don't need an ArmoryPal account.
-- p_has_manage_guild comes from the interaction's signed member.permissions (verified by
-- the discord-interactions function; these RPCs are service_role only).
-- Without Manage Server (a server can open the command to other roles), the old rule
-- applies: the store's owners or ArmoryPal admins, with Discord connected.

-- Who may set up a store in a server. Returns the ArmoryPal user, or null for a
-- Manage Server member without an account. A suspended account is refused either way.
create function public.bot_assert_can_configure(p_discord_id text, p_store_id uuid, p_has_manage_guild boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.user_for_discord(p_discord_id);
begin
  if v_uid is not null and public.is_user_banned(v_uid) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if coalesce(p_has_manage_guild, false) then
    return v_uid;
  end if;
  v_uid := public.bot_resolve(p_discord_id);
  if not public.can_user_manage_store(v_uid, p_store_id) then
    raise exception 'not_store_owner' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

drop function public.bot_link_store(text, text, text, uuid);
drop function public.bot_update_settings(text, text, uuid, int, time, text);

-- /armory link-store: Manage Server, or the store's owners (or admins).
create function public.bot_link_store(
  p_discord_id text, p_guild_id text, p_channel_id text, p_store_id uuid, p_has_manage_guild boolean default false
)
returns public.discord_guild_stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_link public.discord_guild_stores;
begin
  if not exists (select 1 from public.stores where id = p_store_id and archived_at is null) then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.bot_assert_can_configure(p_discord_id, p_store_id, p_has_manage_guild);
  insert into public.discord_guild_stores (guild_id, store_id, channel_id, linked_by)
  values (p_guild_id, p_store_id, p_channel_id, v_uid)
  on conflict (guild_id, store_id) do update
    set channel_id = excluded.channel_id, broken_at = null, broken_reason = null, updated_at = now()
  returning * into v_link;
  return v_link;
end;
$$;

-- /armory settings: same permission as linking. Null arguments stay as they are.
create function public.bot_update_settings(
  p_discord_id text, p_guild_id text, p_store_id uuid default null,
  p_days_before int default null, p_post_time time default null, p_channel_id text default null,
  p_has_manage_guild boolean default false
)
returns public.discord_guild_stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.discord_guild_stores := public.discord_link_for(p_guild_id, p_store_id);
begin
  perform public.bot_assert_can_configure(p_discord_id, v_link.store_id, p_has_manage_guild);
  if p_days_before is not null and p_days_before not between 0 and 6 then
    raise exception 'invalid_days_before' using errcode = '22023';
  end if;
  update public.discord_guild_stores
  set days_before = coalesce(p_days_before, days_before),
      post_time = coalesce(p_post_time, post_time),
      channel_id = coalesce(p_channel_id, channel_id),
      broken_at = case when p_channel_id is null then broken_at end,
      broken_reason = case when p_channel_id is null then broken_reason end,
      updated_at = now()
  where guild_id = v_link.guild_id and store_id = v_link.store_id
  returning * into v_link;
  return v_link;
end;
$$;

revoke all on function
  public.bot_assert_can_configure(text, uuid, boolean),
  public.bot_link_store(text, text, text, uuid, boolean),
  public.bot_update_settings(text, text, uuid, int, time, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.bot_assert_can_configure(text, uuid, boolean),
  public.bot_link_store(text, text, text, uuid, boolean),
  public.bot_update_settings(text, text, uuid, int, time, text, boolean)
to service_role;
