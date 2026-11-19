# ArmoryBot design

ArmoryBot is a Discord bot that shares ArmoryPal's Supabase database. It keeps a Discord server in sync with a store's Armory events: it posts the event, edits that post live, offers Going / Not going / Requests buttons, and DMs players about new and released requests.

**Status:** all four phases are built: groundwork + connected accounts, interactions endpoint, posts and sync, and DMs.

**Change (2026-11-18): server managers set it up.** The person running a Discord server is often not the store's owner on ArmoryPal. `link-store` and `settings` now work for anyone with **Manage Server** in that server (from the signed `member.permissions`, like `unlink`), with no ArmoryPal account needed. Without Manage Server (a server can open the command to other roles), the store's owners and admins still can. A suspended ArmoryPal account is refused. The posts only show what any signed-in player sees on the event page. A public setup guide at `/discord-bot` walks server admins and store owners through it.

**Phase 4 notes (2026-11-18):**
- **Queueing:** DM rows are queued per player by `notify()` (decision B). Each needs the player opted in (decision A), Discord linked, and no "undeliverable" pause in the last 24 h.
- **Batching:** the worker claims a player's rows once the oldest is 2 minutes old, together with any newer ones, so a burst becomes one DM. Two workers claiming the same player at once could split a batch in two (`skip locked`). That's harmless and rare.
- **Checks at send time:** Discord still linked to the same account, DM still on, not banned, event not deleted, cancelled or over, and fewer than 5 attempts. Anything else is dropped with a reason (kept 7 days, then pruned).
- **The message:** one per player, grouped by event ("**Thursday Armory** at Uncommons · <time>" plus one line per actor), worded like the in-app notifications. It has link buttons to each event's Requests tab (up to 4) and to Notification settings, plus a small footer saying why they get it.
- **Undeliverable:** 50007 and 50278 are recorded in `discord_dm_status` and shown on `/settings/notifications`. A later successful DM clears it.
- **Rate limits:** "opening DMs too fast" (40003) is treated like a rate limit. A player's DM channel is reused within a run. Section 1 lists the conflicts found and the decisions made.

**Phase 3 notes (2026-11-18):**
- **Waking the worker:** pg_cron runs `kick_discord_worker(false)` every minute. Outbox inserts also kick it, throttled to one call per 2 seconds; the throttle uses `for update skip locked`, so a player's write never waits on it. Both read the URL and secret from Vault and do nothing until those exist, which keeps CI and fresh local stacks quiet. pg_net only sends after commit.
- **Debounce:** refresh rows wait 2 seconds. A worker woken by the kick waits for them (`bot_next_outbox_in`, up to 5 s) instead of exiting.
- **Scheduled posts** are claimed by inserting the post row with a null `message_id`.
  - **Unfinished claims:** a claim the worker never completed is handed out again after 5 minutes.
  - **Permanent failures** (no access, bad request) release the claim, so the post is retried once the channel is fixed.
  - **Deleted mid-post:** if the event was deleted while posting, `bot_record_post` returns false and the worker deletes the message it just sent.
- **Errors:** Unknown Message → post `gone_at` (never reposted, decision C). Unknown Channel, Missing Access or Missing Permissions → link `broken_at`. Unknown Guild → every link in that server. `/armory settings channel:…` or linking again clears it.
- **Final render:** ended events, and posts in servers that unlinked the store, get one last render with the buttons off, then `finalized_at`.
  - The 10-minute reconcile (`queue_discord_reconcile`, pg_cron) catches events that just ended, display-name changes and anything a trigger missed.
  - Unchanged posts cost no Discord call (`render_hash`).
- **Rate limits:** buckets are learned from headers per route and major parameter. On a 429 the row retries after `retry_after`; a global 429 stops the run. Empty buckets wait up to 5 s in-run, and longer waits are retried later.
- **Format labels** moved to `_shared/formats.ts`; `src/lib/formats.ts` re-exports them.
- **Fixes from first local use:**
  - A worker URL pasted into Vault with a line break made `kick_discord_worker` raise. That function also runs inside players' writes, so it now strips whitespace and swallows pg_net errors as warnings.
  - `bot_next_outbox_in` returned 0 instead of null when nothing was pending, which would have made an idle worker poll until its deadline.
  - Right after a local runtime (re)start, Docker's DNS wasn't ready (`Temporary failure in name resolution`), so the first post or edit waited for the outbox retry (30 s to 5 min). The Discord client now retries network errors after 1 s and 3 s. A POST is retried only for errors from before sending (DNS, connect; `neverSent()`), so a post can never be duplicated. Edits and deletes retry any network error.
  - The DB tests claimed real posts on a developer's stack. Tests now scope `bot_due_posts` to their own server and pause the worker (`discord_worker_state.paused_until`, which is also an ops switch).
- **Facts row:** Date `<t:D>`, Time `<t:t>`, Starts `<t:R>`, Going, Format (or the open poll's tally), then a spacer so the Going columns start on their own row. **Still to check in a real channel:** that `<t:…>` renders inside embed field values.

**Phase 2 notes (2026-11-18):**
- **Verified locally on the real edge runtime** (Deno 2.1, `supabase functions serve`):
  - Relative imports from `_shared/` bundle fine, so no import map is needed.
  - The function reaches PostgREST with its built-in secret key.
  - An unsigned request gets 401, and a signed PING gets PONG.
  - Replies take under 50 ms, far inside Discord's 3 s.
  - Plain `supabase start` serves the function too, and with no key configured it fails closed (401).
- **Deferral:** handlers answer directly. Only one still running after 2.2 s gets a deferred response (type 5, or type 6 for the leave prompt's buttons), and finishes via `EdgeRuntime.waitUntil` plus PATCH `@original`. This path is unit-tested, but whether `waitUntil` outlives the response on hosted Supabase is only verifiable after the first deploy.
- **Database calls:** the function calls PostgREST with plain `fetch` (`_shared/db.ts`) instead of supabase-js, so `_shared` has no imports and Vitest can test it with a fake.
- **Store autocomplete** for `settings` / `unlink` offers only that server's linked stores, via `bot_status`.
- **Tooling:** the root tsconfig now targets ES2020 (for the BigInt permission bits; there's no emit, so Next is unaffected) with `allowImportingTsExtensions`, and excludes `supabase/functions/discord-*` (Deno globals). ESLint ignores the same entrypoints. Deno isn't installed locally, so the entrypoint is checked by the edge runtime when served, not by `deno check`.
- **CI** now starts the edge runtime, so `e2e/security/discord-bot.spec.ts` probes the endpoint.

**Phase 1 notes (2026-11-18):**
- **Moved to later phases:** the worker-only RPCs whose shape depends on the worker: `bot_due_posts` and `bot_record_post` / `bot_mark_broken` go to Phase 3, and `bot_claim_dm_batches` / `bot_record_dm_failure` to Phase 4. `bot_claim_outbox`, `bot_complete_outbox` and `bot_fail_outbox` are in.
- **Added:** the `profile_incomplete` error code (a linked account that never set a display name).
- **Retries:** a retried outbox row stays claimed until its `next_attempt_at`, so it can never collide with a newer pending row (the partial unique index).
- **Unlinking** queues a `refresh` for the server's posts of that store. Phase 3 renders those with disabled buttons, because the link is gone.
- **`/me` doesn't call `discordLink.leaving()`:** the login page's background Discord-link preparation only runs on `/login`, so on `/me` there's nothing to stop.
- **Tests** seed Discord identities into `auth.identities` with the `postgres` dev dependency, because no Supabase API creates them without a real OAuth round-trip.

Docs checked on 2026-11-18: docs.discord.com (interactions, components, message, emoji, rate limits, opcodes, OAuth2) and supabase.com/docs (identity linking, identities, error codes, Edge Functions dev tips, config, limits, secrets, scheduling, pg_net, cron). The installed `@supabase/auth-js` types were checked too.

---

## 1. Conflicts, corrections and open questions

### 1.1 Conflicts with the codebase

1. **`auth.uid()` is used deep inside the shared logic, not just in `attend_event` and `leave_event`.** Bot RPCs run as `service_role`, where `auth.uid()` is null. These internal functions read it today:
   - `assert_event_open`, through `is_banned()`.
   - `release_my_pledges`.
   - `cancel_request_internal` and `leave_event`, through `my_display_name()`.
   - `new_request_recipients`.
   - The `attendee_left` loop in `leave_event`.

   The refactor therefore covers those helpers too, not only attend and leave (see §4.3). `remove_from_event` already duplicates most of `leave_event` for an explicit user. I'll fold both onto one internal function so the rules can't drift.
2. **`current_events_for_stores` raises `not signed in` when `auth.uid()` is null**, so the worker can't call it. I'll split it:
   - An internal `ensure_current_events(store_ids)` with no auth check, granted to `service_role` only.
   - The public RPC does the auth check and then calls the internal one. Its behaviour doesn't change.
3. **The lazy-creation window fits `days_before` 0–6.** `event_occurrence` returns the next weekday, counting today until local midnight. So when a post is due (at most 6 days ahead), the event is already "current" for its slot. `owner_upcoming_events` may also have pre-created later weeks; the scheduler only looks inside the window, so those never post early.
4. **Deleting a one-off event hard-deletes the row** (cascade). The worker needs the Discord message IDs to delete the posts, so:
   - `discord_event_posts.event_id` gets **no** cascading FK.
   - A `before delete` trigger on `events` queues a `delete_posts` outbox row that **carries the message list in its payload**.
   - Weekly deletes keep their marker row (`deleted_at`), and the update trigger handles those.
5. **"Store name and area":** stores have `city`, `region` and `country`, and no "area". The author line will be `<name> · <city>, <region>`, or `<city>, <country>` when there's no region.
6. **The prompt has `notify()` stay unchanged for in-app, but DMs need per-user rows.** See §4.4. I'll hook DM queueing into `notify()` as a second, independent insert. The in-app insert and its preference check stay byte-for-byte the same.
7. **`notification_preferences` has primary key `(user_id, kind)`**, and `src/app/actions/notification-preferences.ts` upserts on it. Adding a `channel` column means changing that primary key and the upsert's `onConflict` (§4.5).
8. **Root `tsconfig.json` includes `**/*.ts`.** That would pull Deno code (with `Deno.*` globals and `npm:`/`jsr:` specifiers) into `npm run typecheck`. See §6.1.

### 1.2 Corrections from the docs

1. **A bot can only DM a user it shares a guild with.**
   - Discord error **50278**: "Cannot send messages to this user due to having no mutual guilds". 50007 covers privacy settings and blocks.
   - So "followers via `user_stores`" only get DMs if they're in at least one server the bot is in. Today that's effectively a linked server.
   - I treat 50278 like 50007: record it, don't retry that DM, and show it in settings ("ArmoryBot can't DM you: join a server it's in and allow DMs from server members").
2. **Discord says "DMs should generally be initiated by a user action".** **Decided (A): Discord DMs are opt-in.** For the `discord` channel a missing row means **off**; players turn DMs on in `/settings/notifications`. In-app keeps "missing row = on".
3. **`<t:…>` timestamps are documented for message content only.**
   - They're known not to render in embed **titles**, and the docs don't confirm field values or descriptions.
   - The design puts date and countdown in **field values** (where they do render in practice, in my experience). Phase 3 verifies this on the dev server, and the fallback is the message `content` line.
4. **Discord user ID:** `auth.identities.provider_id` where `provider = 'discord'` (Supabase docs: "The provider id returned by the provider"). I'll read it from `provider_id`, not `identity_data->>'sub'`.
   - The docs don't state a `unique (provider_id, provider)` constraint. Phase 1 adds a DB test that asserts the constraint exists in `auth.identities`, so the "one Discord account → one ArmoryPal account" guarantee rests on something checked.
5. **`linkIdentity` takes the same options as `signInWithOAuth`** (`redirectTo`, `scopes`, `queryParams`, `skipBrowserRedirect`; checked in the installed `auth-js` types). So `prompt=none` and the existing PKCE handling carry over.
   - Error codes:
     - `identity_already_exists`: the identity is linked to another user.
     - `manual_linking_disabled`: manual linking is off on the server.
     - `single_identity_not_deletable`: you tried to unlink the last identity.
   - Manual linking is still labelled **beta**.
6. **Auth on the Edge Functions:**
   - The new key model gives functions `SUPABASE_SECRET_KEYS` (JSON, use `['default']`), and the docs recommend `verify_jwt = false` with a key or shared secret for cron-invoked functions.
   - So **both functions run with `verify_jwt = false`**. The interactions function authenticates with Discord's Ed25519 signature, and the worker with its own shared secret (constant-time compare).
7. **pg_net requests start only after the transaction commits.** That's what we want: a rolled-back RPC never kicks the worker.
8. **Limits:**
   - Edge Functions: 2 s CPU per request (async I/O excluded), 150 s wall-clock on Free, 256 MB.
   - Discord: 50 req/s global, and 10,000 invalid (401/403/429) requests per 10 min before a temporary ban.
   - Rate limits must not be hard-coded. The worker reads the `X-RateLimit-*` headers.
9. **Components V2 isn't used.** A V2 message can't carry embeds, and the brief wants a Raid-Helper-style embed. We use classic embeds plus action rows.
10. **Same application for OAuth and bot:** supported. The bot gets `bot` + `applications.commands` scopes. Bot and user rate limits are separate.

### 1.3 Decisions (answered 2026-11-18)

- **A. DM default:** **off.** Discord DMs are opt-in per kind; a missing `discord` row means off.
- **B. DM queue shape:** approved. Per-user rows written from `notify()` (§4.4).
- **C. Hand-deleted post:** approved. Mark it gone (10008) and don't repost.
- **D. Pitch emojis:** approved. v1 uses 🔴🟡🔵🟣; application emojis come later behind a config map.

---

## 2. Architecture

```
Discord ──signed POST──▶ Edge Function discord-interactions ──rpc (secret key)──▶ bot_* RPCs ──▶ shared internal SQL
                                                                                       │
             app RPCs / triggers ──insert──▶ discord_outbox / discord_dm_queue ────────┤
                                                    │ statement trigger: pg_net kick   │
pg_cron (every minute) ──pg_net──▶ Edge Function discord-worker ──claim (skip locked)──┘
                                         │
                                         └──bot token──▶ Discord REST (posts, edits, deletes, DMs)
```

- **No always-on process and no gateway connection.** One consequence: we never hear "bot was removed from a server" or "channel deleted". We find out when a REST call fails (10003 Unknown Channel, 10004 Unknown Guild, 50001 Missing Access, 50013 Missing Permissions), and then mark the link `broken_at`. `/armory status` shows it.
- **Secrets:**
  - In Supabase function secrets: `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_WORKER_SECRET` and `ARMORYPAL_URL`.
  - In Vault, so pg_cron/pg_net can call the worker: `discord_worker_url` and `discord_worker_secret`.
  - None of them go to Vercel or the Next.js app.
- **The functions call the database** with `supabase-js` using `SUPABASE_URL` and the default secret key, and **only call `bot_*` RPCs**. They never touch tables directly.

### 2.1 `discord-interactions`
1. Read the raw body. Verify `X-Signature-Ed25519` over `X-Signature-Timestamp + body` with `DISCORD_PUBLIC_KEY` (WebCrypto Ed25519). Return **401** on a missing or invalid signature, and reject timestamps older than 5 minutes.
2. `PING` (type 1) → `{ type: 1 }`.
3. Route by type:
   - Type 2: slash command.
   - Type 3: button, custom_id `ap:<action>:<event_uuid>`, at most 46 chars.
   - Type 4: autocomplete.
4. Respond inside 3 s:
   - **Fast paths** (autocomplete, Going, the leave prompt) call one RPC and respond directly (type 4/7/8).
   - **Slower paths** (Requests list, `link-store`, `status`) return type 5 with flag 64 (deferred, ephemeral) and finish through `EdgeRuntime.waitUntil()`, editing the original response (`PATCH /webhooks/{app}/{token}/messages/@original`, token valid 15 min). Phase 2 confirms that `waitUntil` keeps running after the response on hosted Supabase. The fallback is to kick the worker with the token.
5. **Every response** sets `allowed_mentions: { parse: [] }`. Every reply to a button or command is **ephemeral** (flag 64). Only the worker posts in channels.
6. **Invoker:** `member.user.id` in guilds. Commands are guild-only, and `contexts` excludes DMs.

### 2.2 `discord-worker`
1. Check the `Authorization: Bearer <DISCORD_WORKER_SECRET>` header (constant-time). Otherwise 401.
2. Loop until the queue is empty, about 50 s have passed, or Discord returns a global 429. Each step:
   - `bot_claim_outbox(limit)`: rows due, `for update skip locked`, marked claimed for 2 minutes.
   - `bot_due_posts()`: scheduled posts whose time has come (§5.1).
   - `bot_claim_dm_batches(limit)`: users whose batch window has closed (§6).
   - Apply each item through the REST client, then `bot_complete(...)` / `bot_fail(..., retry_after)`.
3. **Triggers:**
   - pg_cron `* * * * *`.
   - A statement-level trigger on `discord_outbox` / `discord_dm_queue` that fires a pg_net kick, at most once per statement, and only when new rows were actually inserted.
   - Concurrent runs are safe because claims use `skip locked`.
4. **REST client** (`_shared/discord-rest.ts`, pure, with an injected `fetch`):
   - Tracks buckets from `X-RateLimit-Bucket` / `-Remaining` / `-Reset-After`, and waits or yields when a bucket is empty.
   - On 429, honours `retry_after`. It stops the run on `global: true`, and otherwise sets the item's `next_attempt_at`.
   - Never retries 4xx except 429.
   - Retries 5xx with exponential backoff, up to 8 attempts, then sets `failed_at`.

---

## 3. Identity

```sql
-- internal; revoked from public/anon/authenticated, granted to service_role
public.user_for_discord(p_discord_id text) returns uuid      -- null when not linked
public.discord_id_for_user(p_user_id uuid) returns text     -- null when not linked
```
- Both read `auth.identities` (`provider = 'discord'`, `provider_id`). Every `bot_*` RPC starts with `v_uid := public.bot_resolve(p_discord_id)`, which:
  - raises `discord_not_linked` when null,
  - and otherwise runs the usual ban check for that user.
- There's no linking table. The link exists exactly as long as the Supabase identity does, so disconnecting in `/me` immediately stops buttons and DMs.
- Discord IDs are `text` everywhere, because snowflakes exceed JS safe integers.

---

## 4. Database (Phase 1)

### 4.1 Tables

All tables get RLS enabled with **no policies** for `authenticated` (except `discord_dm_status`, below), and `all` for `service_role`. `anon` gets nothing.

**`discord_guild_stores`**

| column | type | notes |
|---|---|---|
| guild_id | text | |
| store_id | uuid → stores, on delete cascade | |
| channel_id | text | |
| days_before | smallint, check 0–6, default 2 | |
| post_time | time, default `'10:00'` | store-local |
| linked_by | uuid → profiles, on delete set null | |
| created_at, updated_at | timestamptz | |
| broken_at, broken_reason | timestamptz, text | set by the worker on 10003/10004/50001/50013 |

- Primary key `(guild_id, store_id)`: a server links each store once.
- **Many-to-many:** a server can link several stores, and a store several servers.
- **Visibility:** store managers may want to see which servers show their store. That's out of v1; it's readable later via an RPC.

**`discord_event_posts`**: `guild_id`, `event_id` (uuid, **no FK**, see §1.1.4), `channel_id`, `message_id` (nullable while a post is being created), `posted_at`, `last_rendered_at`, `render_hash`, `finalized_at`, `gone_at`.
- Primary key `(guild_id, event_id)`, so there's one post per server per event.
- `render_hash` lets the worker skip edits when nothing visible changed (it saves rate-limit budget in the 10-minute reconcile).

**`discord_outbox`**: `id bigint identity`, `kind`, `event_id uuid` (no FK), `payload jsonb`, `created_at`, `next_attempt_at`, `claimed_until`, `attempts`, `processed_at`, `failed_at`, `last_error`.
- **Kinds** (`public.discord_outbox_kind` domain):
  - `refresh`: re-render all posts of the event.
  - `cancelled`: render the cancelled state; same as refresh, but kept separate for logging and tests.
  - `moved`: refresh.
  - `delete_posts`: payload `[{channel_id, message_id}]`.
- **Coalescing:** a unique partial index `(kind, event_id) where processed_at is null and claimed_until is null` plus `on conflict do nothing`. A burst of 30 changes becomes one pending row. A change that arrives while a row is being processed queues one new row, so nothing is lost.
- **Debounce:** `refresh` rows get `next_attempt_at = now() + 2 s` to catch the rest of a burst.

**`discord_dm_queue`** (per user; see §4.4 for why it isn't in the outbox): `id`, `user_id`, `discord_id`, `event_id`, `kind` (`new_requests` | `card_needed_again`), `payload` (same shape as the notification), `created_at`, `send_after`, `claimed_until`, `sent_at`, `dropped_reason`.

**`discord_dm_status`**: `user_id` (primary key), `undeliverable_at`, `error_code` (50007 / 50278).
- Users can read their own row (that's the only `authenticated` policy), so settings can show "ArmoryBot can't DM you".
- After a failure, DMs to that user are skipped for 24 h, then tried once more. A success clears the row. Each failed DM is dropped, never retried, as the brief asks. The cooldown keeps us far from the 10k-invalid-requests limit.

**Pruning:** a daily pg_cron job deletes processed outbox and DM rows older than 7 days.

### 4.2 Triggers that fill the outbox
All of them are statement-level (like `broadcast_event_changes`), so one SQL statement queues at most one row per event.

| Source | Queues |
|---|---|
| `attendances`, `requests`, `pledges`, `format_polls`, `format_votes` insert/update/delete | `refresh` for each affected `event_id` |
| `events` update where `label`, `starts_at`, `ends_at`, `format` changed | `moved` if `starts_at` changed, otherwise `refresh` |
| `events` update setting `cancelled_at` | `cancelled` |
| `events` update setting `deleted_at` (weekly delete marker) | `delete_posts` (message list read from `discord_event_posts`) |
| `events` delete (one-off) | `delete_posts`, with the list captured before the row goes |
| `stores` update of name/city/region | `refresh` for that store's live posted events |

- **Short-circuit:** a trigger queues nothing when the event has **no** rows in `discord_event_posts`, so stores without Discord pay one index lookup.
- **Scheduling isn't trigger-driven.** The worker polls for due posts (§5.1).

### 4.3 Refactor: user-ID variants of the shared logic
This is a new migration; old migrations stay as they are. The public RPCs keep their signatures and behaviour, and each becomes a thin wrapper over an internal helper.

| Internal helper (no `execute` for `authenticated`) | Replaces | Public wrapper |
|---|---|---|
| `is_user_banned(uid)` | body of `is_banned()` | `is_banned()` → `is_user_banned(auth.uid())` |
| `assert_event_open_for(event, uid)` | body of `assert_event_open` | `assert_event_open(event)` → `…_for(event, auth.uid())` |
| `display_name_of(uid)` | `my_display_name()` | `my_display_name()` wraps it |
| `release_pledges(event, uid, actor, reason)` | `release_my_pledges` and the first loop of `remove_from_event` | both call it |
| `cancel_request_internal(request, reason, actor)` | adds an `actor` parameter | callers pass it |
| `attend_event_as(event, uid)` | body of `attend_event` | `attend_event` |
| `leave_event_as(event, uid, cancel_requests, reason)` | bodies of `leave_event` and `remove_from_event` | `leave_event(e, c)` → `(e, auth.uid(), c, 'left_event')`. `remove_from_event(e, u)` → `(e, u, true, 'removed')`, without the `attendee_left` owner notification |
| `ensure_current_events(store_ids)` | body of `current_events_for_stores` | public RPC checks auth, then calls it |

- **Same lock order** as today: release pledges, then the requester's requests `order by id … for update`, then attendance.
- **Regression net:** the existing DB tests for attend, leave, remove, ban and copy keep passing unchanged. New tests call the `_as` variants directly and through `bot_*`.
- **Signature change:** `cancel_request_internal` gains a parameter, so it's a `drop function` + `create`. Its execute grants are re-applied in the migration.

### 4.4 DM queueing (why it's per user)
The audience for `new_requests` / `card_needed_again` is resolved inside SQL **at the moment of the change**, in the `notify()` loops. Re-deriving it later in the worker would give a different answer when someone joins or leaves in between. Batching and "one DM per person" are per-user operations anyway. So:

```sql
create or replace function public.notify(p_user_id uuid, p_event_id uuid, p_kind text, p_payload jsonb) ...
  -- 1. in-app insert: unchanged (same preference check, channel 'app')
  -- 2. new: if p_kind in ('new_requests','card_needed_again')
  --         and discord_id_for_user(p_user_id) is not null
  --         and an ENABLED pref row (p_user_id, p_kind, 'discord') exists   -- opt-in (decision A)
  --         and not cooling down in discord_dm_status
  --    then insert into discord_dm_queue (…, send_after = now() + interval '2 minutes')
```

- The in-app path is untouched: disabling in-app doesn't disable Discord, and vice versa.
- One DM per person falls out naturally, because the queue is keyed by user, not by server.
- Unlinked users get no row at all (no error).
- **Cost:** one extra identity lookup per recipient per announcement, through an index on `auth.identities (user_id)`. Fine at this scale.
- **Alternative considered:** event-level outbox rows expanded by the worker. Rejected because of the audience drift above, and because the worker would need to re-implement `event_audience` exclusions (actor, requesters, bans).

### 4.5 DM preference: a `channel` column
`notification_preferences` gets `channel public.notification_channel not null default 'app'` (domain: `'app' | 'discord'`), and the primary key becomes `(user_id, kind, channel)`.
- **Why a column rather than a new table:**
  - Same shape: one row per (user, kind, channel) with `enabled`. Defaults differ by channel: a missing `app` row means on (unchanged), a missing `discord` row means off (decision A). The default lives in one place per channel: `notify()` in SQL and `isEnabled(kind, channel, rows)` in `src/lib/notifications.ts`.
  - Same RLS policies, including the existing `not public.is_banned()` write check.
  - One query on the settings page.
  - `prune`/cascade behaviour carries over.
  - A second table would duplicate all four policies and the ban check.
- A check constraint limits `channel = 'discord'` to `new_requests` and `card_needed_again` in v1.
- **Code changes:** the upsert in `src/app/actions/notification-preferences.ts` switches to `onConflict: 'user_id,kind,channel'`, and the settings page filters `channel = 'app'` for the existing toggles.
- **New TS:** `NOTIFICATION_CHANNELS` and `DISCORD_DM_KINDS` in `src/lib/notifications.ts`.

### 4.6 `bot_*` RPCs
All of them are `security definer` with `set search_path = ''`, `execute` granted to **`service_role` only**, and revoked from `public`, `anon` and `authenticated`. Each one takes the invoker's Discord ID first and resolves it via `bot_resolve` (`discord_not_linked`, `banned`).

| RPC | Does |
|---|---|
| `bot_search_stores(q)` | Wraps `search_stores` ranking (minus archived), max 25, returns `id, name, city, region`. No user needed, since autocomplete runs for unlinked admins too. |
| `bot_link_store(discord_id, guild_id, channel_id, store_id, has_manage_guild bool)` | Allowed with `has_manage_guild` (no ArmoryPal account needed; `linked_by` is null then), or for a store manager with Discord linked, else `not_store_owner` (`bot_assert_can_configure`, migration `*_bot_server_managers.sql`). A suspended account is refused either way (`banned`). Upserts the link and clears `broken_at`. Returns the link plus its next post time. |
| `bot_update_settings(discord_id, guild_id, store_id?, days_before?, post_time?, channel_id?, has_manage_guild?)` | Same check. Validates `days_before` 0–6 (`invalid_days_before`). When the server links several stores, `store_id` is required (`store_required`). |
| `bot_unlink_store(discord_id, guild_id, store_id?, has_manage_guild bool)` | Allowed if `has_manage_guild` **or** the user can manage the store, else `not_store_owner`. The boolean comes from the signed interaction's `member.permissions` (MANAGE_GUILD = `1 << 5`), which the function verified. The DB can't check Discord permissions itself, and the RPC is reachable only with the secret key. Unlinking doesn't delete existing posts; they're finalized (buttons disabled). |
| `bot_status(guild_id)` | Links, settings, `broken_at` and next post per store. Read-only; the command is already gated by Manage Server. |
| `bot_attend(discord_id, event_id)` | `attend_event_as` |
| `bot_leave(discord_id, event_id, cancel_requests)` | `leave_event_as(…, 'left_event')` |
| `bot_event_requests(discord_id, event_id)` | Rows shaped like `buildRequestViews` input: requests with card name, pitch, quantities and requester. The worker reuses the TS view logic (§7). |
| `bot_render_event(event_id)` | Everything `renderEventPost()` needs: event, store, attendees in join order with request counts, kept-request people, open requests, poll and format. |
| `bot_claim_outbox(limit)` / `bot_due_posts()` / `bot_claim_dm_batches(limit)` | Worker claims (§2.2, §5.1, §6) |
| `bot_complete(...)` / `bot_fail(...)` / `bot_record_post(...)` / `bot_mark_broken(...)` / `bot_record_dm_failure(...)` | Worker bookkeeping |

- **The worker-only RPCs** take no Discord ID.
- **New error codes**, added to `ruleMessage()` and to the bot's `botMessage()` map in `_shared/messages.ts`: `discord_not_linked`, `invalid_days_before`, `store_required`, `store_not_linked`. Everything else reuses existing codes (`not_store_owner`, `event_ended`, `event_cancelled`, `event_not_found`, `banned`, `not_attending`, …).
- `assert_event_open_for` applies the full rule set to bot calls: deleted, ended, cancelled and banned events.

### 4.7 Grants and security tests
- **Migration grants:** explicit grants for every table and function.
- **`tests/db/discord-*.test.ts`:**
  - Each `bot_*` RPC enforces the same rules as the app: ended, cancelled, deleted, banned, unlinked.
  - Link permission: Manage Server succeeds even without an ArmoryPal account; without it, owner and admin succeed and a non-owner gets `not_store_owner`.
  - The triggers queue the right outbox rows, and coalesce them.
  - `notify()` queues DMs only for linked users with the channel on.
  - The `auth.identities` uniqueness constraint exists.
  - The existing leave/remove tests stay green.
- **`e2e/security/discord-bot.spec.ts`:**
  - `anon` and `authenticated` get permission errors on every `bot_*` RPC.
  - They can't select or modify the new tables (except `discord_dm_status` own-row read).
  - The internal helpers aren't executable.
  - Phase 2/3 add the functions themselves: unsigned or invalid signature → 401, and worker without its secret → 401.

---

## 5. Posts and sync (Phase 3)

### 5.1 Scheduled posting
`bot_due_posts()`:
1. Calls `ensure_current_events(store_ids of all non-broken links)`.
2. For each link × event of that store selects the pairs where:
   - the event is not deleted, not ended, and has no `discord_event_posts` row for that guild;
   - and `now() >= ((event.event_date - days_before) + post_time) at time zone store.timezone`.
   This covers weekly and one-off events alike, and a link created after the post time posts on the next run.
3. Inserts the post row with a null `message_id` (claimed) and returns the pairs.

**Edge cases:**
- **Cancelled before posting:** posted anyway in the cancelled state, so the server sees the cancellation.
- **Moved past the post time:** posts at the next run.

### 5.2 Rendering: `renderEventPost(data, opts)` in `_shared/`
- Pure: data in, `{ embeds: [embed], components, allowed_mentions }` out.
- **Author:** `<store> · <city, region>`, linking to the store page.
- **Title:** `event.label` (`Cancelled · <label>` when cancelled), linking to `/events/<id>`.
- **Facts row:** three inline fields.
  - 📅 `<t:start:F>`.
  - ⏰ `<t:start:t>` plus `<t:start:R>`.
  - 👥 `N going`.
- **Format:** a fourth field. 🏷️ confirmed format name (`FORMATS`), or "Poll open: Draft 3 · CC 1" with results from `pollResults()` logic.
- **Going:** three inline fields (`Going (1–n)`, then `​` names), numbered in join order, with `· N req`.
- **"Not going, kept requests"** field.
- **"Open requests":** top 3 by remaining quantity, `🔴 · 2× Card name · Alice`, then `+N more in ArmoryPal`.
- **Footer:** `ArmoryPal · updates live`. **Colour:** `0x99C41E`, or grey `0x8A8A8A` when cancelled.
- **Buttons:** Going (Success) and Not going (Danger, red) on the first row; Open in ArmoryPal (Link) on its own row. There's no Requests button on the post (changed after first use, 2026-11-18); its `ap:requests:` handler stays for posts made before the change.
  - Disabled when cancelled or ended. The link button stays live.
  - Going and Not going stay enabled until `ends_at`, like the app.
- **Budget:** a shared `fitEmbed()` enforces 256/1024/25/6000, and shortens lists with `+N more in ArmoryPal`. It's unit-tested on the edges.
- **Snapshot tests:** normal, empty, very large, cancelled, ended, one-off, poll open, format confirmed, store without region.
- **Names are escaped** for Discord markdown (`escapeMarkdown()`), and there are no mentions at all.

### 5.3 Sync rules
- **`refresh` / `moved` / `cancelled`:** re-render each live post of the event (not `finalized_at`, not `gone_at`). The PATCH is skipped when `render_hash` is unchanged.
- **`delete_posts`:** delete each message (404/10008 counts as done). No notice in the channel, matching the app.
- **Ended:**
  - The first worker run after `ends_at` renders the post once more, with buttons disabled, and sets `finalized_at`.
  - Later triggers ignore finalized posts.
- **Reconcile:** every ~10 minutes (`minute % 10 = 0` inside the cron run), queue `refresh` for every live post, plus finalization for posts whose events ended. The hash skip keeps this cheap.
- **Errors:**
  - Message deleted (10008): set `gone_at`.
  - Channel or guild gone, or permissions missing: `bot_mark_broken` on the link, and stop posting there until `/armory settings` or a re-link.

---

## 6. DMs (Phase 4)
- `bot_claim_dm_batches(limit)` returns users whose **oldest** unsent row is past `send_after` (2 minutes). It returns all of that user's unsent rows at once, grouped by event.
- `batchDms(rows)` in `_shared/dm.ts` (pure, unit-tested) builds **one message per user**. Within it, one paragraph per event:
  - "Alice needs 3 cards for Thursday Armory at Uncommons: 2× Snatch (Red), Command and Conquer …".
  - "Bob can't bring 2 cards anymore for …".
  - Multiple actors are listed, and long lists end with `+N more`.
  - **Buttons:** one Link button to `/events/<id>?tab=requests` per event, up to 5.
- **Sending:** `POST /users/@me/channels {recipient_id}` (it returns the existing channel), then `POST /channels/{id}/messages` with `allowed_mentions: { parse: [] }`.
- **50007 / 50278:** mark the rows `dropped_reason`, upsert `discord_dm_status`. No retry.
- **40003 (opening DMs too fast):** back off like a 429.
- **Before sending:** re-check that the identity still exists and the preference is still on, since the player may have disconnected in the last two minutes.

---

## 7. Shared code layout and tooling
- **`supabase/functions/_shared/`:** pure TS, no `Deno.*`, no `npm:`/`jsr:` imports, relative imports with explicit `.ts` extensions (which Deno requires).
  - `render-event.ts`, `fit-embed.ts`, `dm.ts`, `messages.ts`, `discord-rest.ts` (injected fetch), `verify.ts` (Ed25519 via WebCrypto, which works in both Deno and Node 20), `custom-id.ts`.
  - Supabase's docs recommend exactly this underscore folder for shared code imported by relative path. **Phase 2 confirms** with `supabase functions deploy --dry-run`-style bundling (or a deploy to the dev project) that relative imports bundle and `_shared` isn't deployed as a function. If it doesn't work, the fallback is per-function `deno.json` import maps pointing at `../_shared/`.
- **Sharing with `src/lib`:** the renderer needs pure logic that exists in `src/lib` (`coverage`, `FORMATS`, pitch order). Deno can't resolve the `@/` alias, so the shared bits that both sides need move **into `_shared/`**, and `src/lib` re-exports them. The functions never import from `src/`.
- **Tooling:**
  - `vitest.config.mts`: `include` adds `supabase/functions/_shared/**/*.test.ts`.
  - Root `tsconfig.json`: add `"allowImportingTsExtensions": true` (valid with `noEmit`), and exclude `supabase/functions/*` except `_shared`. The Deno entrypoints get their own `deno.json` per function and are checked with `deno check` in CI, if Deno is available on the runner (to confirm in Phase 2).
  - `eslint.config.mjs`: ignore the Deno entrypoints, lint `_shared`.
- **`config.toml`:**

  ```toml
  [functions.discord-interactions]
  verify_jwt = false
  [functions.discord-worker]
  verify_jwt = false
  ```

---

## 8. Phase 1b: connected accounts
- **`/me` → "Connected accounts":** lists `user.identities` (Discord, Google, email).
  - **Connect Discord:** a client component calls `discordLink.leaving()` and then `supabase.auth.linkIdentity({ provider: 'discord', options: { redirectTo: <origin>/auth/callback?next=/me, queryParams: { prompt: 'none' } } })`.
  - **Disconnect:** `unlinkIdentity(identity)`, shown only when another identity remains (Supabase also enforces this with `single_identity_not_deletable`).
- **`/auth/callback`:** already exchanges the code and honours `safeNext(next)`. It adds error mapping:
  - `identity_already_exists` → `/me?link_error=identity_already_exists`, which shows "This Discord account already has its own ArmoryPal account. Sign in with Discord instead, or ask an admin to merge them."
  - `manual_linking_disabled` → a generic message.
  - The `other_browser` case keeps its current redirect but returns to `next`.
  - **Note:** OAuth errors come back as `?error=…&error_code=…` query params on the redirect, not as an exchange error. The callback reads both.
- **Phone app handoff:** the direct `discord.com/oauth2/authorize` trick on the login page isn't reused for linking in v1. Linking is a one-time action on `/me`, so the plain redirect is fine and simpler. The trick could be added later.
- **`config.toml`:** `enable_manual_linking = true`. **`DEPLOY.md`:** enable "Manual linking" in the dashboard (Authentication → Sign In / Providers), and note that it's beta.
- **`/settings/notifications`:** a "Discord DMs" column for `new_requests` and `card_needed_again`. If there's no Discord identity: "Connect Discord to get DMs" → `/me`. If `discord_dm_status` is flagged: the can't-DM hint.
- **Tests:**
  - `e2e/functional/connected-accounts.spec.ts` covers the UI states (not linked, linked with one identity so Disconnect is hidden, linked with two, and the `link_error` banner) using seeded identities, without a real Discord round-trip.
  - `e2e/security/`: a Discord identity can't be attached to a second account. Seeding the same `provider_id` twice fails, and the callback error path shows the message.

---

## 9. Discord features (Phase 2)
- **Command (global, guild-only):** `/armory` with `default_member_permissions = "32"` (Manage Server). Subcommands:
  - `link-store store:<autocomplete string> channel:<channel, text/announcement, optional>`
  - `settings [store] [days_before 0–6] [post_time HH:MM] [channel]`
  - `unlink [store]`
  - `status`
- **`scripts/register-discord-commands.mts --env <file>`:** bulk overwrite `PUT /applications/{id}/commands`. It prints the target app ID like the other scripts, and `--guild <id>` registers instantly on the dev server.
- **Buttons:**
  - **Going** → `bot_attend` → ephemeral "You're going to …". The post refresh comes from the outbox.
  - **Not going** → an ephemeral message with two Danger/Secondary buttons, `ap:leave-cancel:<id>` / `ap:leave-keep:<id>`. With no requests, it shows a single "Leave" button.
  - **Requests** → deferred ephemeral list. Same ordering as the Requests tab, up to the 1 embed / 6000 budget, then "+N more".
  - **Unlinked user** (no ArmoryPal account with this Discord ID): **Going** adds them as a **Discord guest** (`discord_attendees`, migration `*_discord_guests.sql`). `bot_attend` returns `'guest'`, and the reply ("You're on the Going list!") carries a "Sign in with Discord" link to `/login?next=/events/<id>?tab=requests`. **Not going** sees `discord_not_linked` from `bot_event_requests` and calls `bot_guest_leave` (no prompt: guests have no requests or pledges). Other buttons still reply "Connect your Discord to ArmoryPal" with a Link button to `/me#connected-accounts`.
- **Discord guests:**
  - **Name:** server nickname, else Discord display name, else username (`invokerName()`), at most 40 chars, refreshed on every tap. A blank name becomes "Discord player".
  - **Where they show:** in the post's Going list and the app's Going tab, merged by join time. The app marks them "via Discord", and going counts include them. They can't request, pledge or vote, aren't in `event_audience` and get no notifications.
  - **Privacy:** signed-in players can read `id, event_id, display_name, created_at` (column grants), never `discord_id`.
  - **Claiming:** `claim_discord_spots(user)` turns a Discord ID's guest rows into attendances (keeping `created_at`, so the join order holds, past events included) and deletes them. Banned players' rows are dropped. It runs from `/auth/callback` (`claim_my_discord_spots()`, after every sign-in or Connect), from a `profiles` trigger when a display name is first set, and from `bot_attend` for linked players.
  - **Cleanup:** one-offs cascade; deleting a weekly event clears its guests (trigger on `events.deleted_at`). Admins remove a guest with `admin_remove_discord_attendee` (logged as `remove_attendee`, "<name> (via Discord)").

---

## 10. Setup

**Production:** see `DEPLOY.md` §11. That covers the bot user on the existing app, secrets, deploying, the endpoint URL, command registration and the invite link. The worker's Vault secrets come in Phase 3.

**Dev app (local testing).** Use a separate Discord application, so experiments never touch the real bot.
1. **Create the app:** discord.com/developers → New Application ("ArmoryBot Dev").
   - Bot → Reset Token.
   - Installation → Guild Install, scopes `bot` + `applications.commands`.
2. **Test server:** create a private Discord server. Invite the dev bot with
   `https://discord.com/oauth2/authorize?client_id=<DEV_APP_ID>&scope=bot+applications.commands&permissions=84992`.
3. **Secrets:** copy `supabase/functions/.env.example` to `supabase/functions/.env` and fill in the dev app's App ID, Public Key and bot token.
4. **Serve the functions** (both: interactions and worker; leave it running):
   ```powershell
   npx supabase functions serve --env-file supabase/functions/.env
   ```
   `npx supabase start` also serves functions, but `functions serve --env-file` is the verified way to pass the secrets.
   Set `DISCORD_WORKER_SECRET` in `.env` first (see `.env.example`).
5. **Tunnel**, so Discord can reach your machine:
   ```powershell
   cloudflared tunnel --url http://127.0.0.1:54321
   ```
   (or `ngrok http 54321`). Set the dev app's Interactions Endpoint URL to `https://<tunnel host>/functions/v1/discord-interactions`. The tunnel host changes on every restart, so update the URL each time.
6. **Register the commands on your test server only** (instant):
   ```powershell
   npx tsx scripts/register-discord-commands.mts --guild <test server id>
   ```
6b. **Let the local database wake the worker** (one time; the database container reaches your machine via `host.docker.internal`).
   In Studio (http://127.0.0.1:54323) → SQL Editor, with the same `DISCORD_WORKER_SECRET` value:
   ```sql
   select vault.create_secret('http://host.docker.internal:54321/functions/v1/discord-worker', 'discord_worker_url');
   select vault.create_secret('<DISCORD_WORKER_SECRET>', 'discord_worker_secret');
   ```
   To stop local posting: `delete from vault.secrets where name in ('discord_worker_url', 'discord_worker_secret');`.
   `npx supabase db reset` wipes them too.
7. **Become a store manager with Discord linked:**
   - Sign in to the local app with Discord. Local Discord login uses the app in `config.toml`, so it's your real Discord user either way.
   - Or sign in another way and use Profile → Connect.
   - Then `npx tsx scripts/make-admin.mts <your email>`.
   - `/armory link-store` should now work in the test server.

Without the tunnel, the unit tests and the e2e security tests cover the endpoint. For a hand test, the scratch approach used in Phase 2 works: serve with a throwaway key pair and send signed requests from Node.

---

## 11. Out of scope (v1)
- A Maybe/Tentative status.
- Hero/class grouping of the Going list.
- Pledging from Discord.
- Format voting from Discord.
- Admin account merging.
- A synced follower role.
- Application-emoji pitch icons.
- Store managers seeing which servers show their store.
- Reposting manually deleted posts.

---

## 12. Phase plan
1. **Phase 1:** migrations §4, refactor §4.3, `bot_*` RPCs, grants, DB tests, security e2e, `db:types`, CLAUDE.md. **1b:** §8.
2. **Phase 2:** `_shared` verify/messages/custom-id, `discord-interactions`, registration script, tooling (§7). Verify bundling and `waitUntil`.
3. **Phase 3:** worker, REST client, pg_cron/pg_net/Vault wiring, scheduled posting, renderer with snapshots, cancel/delete/move/finalize, reconcile. Verify that `<t:>` renders in fields.
4. **Phase 4:** DM queue, `batchDms`, preference re-check, failure recording, settings UI states.

I'll stop after each phase for review, as you asked.
