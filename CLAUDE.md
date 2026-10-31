# ArmoryPal

Mobile-first companion PWA for the Flesh and Blood TCG. Players coordinate card loans around their store's weekly Armory event: attendees list cards they need, other attendees pledge to bring them, and everyone viewing the event sees changes in real time.

## Environment
- The developer is on Windows using PowerShell in Zed. **Give PowerShell commands, not bash** (use `;` / `if ($?) { }`, not `&&`).
- Node 20+, Docker Desktop (needed for local Supabase).

## Stack (agreed)
- **Next.js 15 (App Router) + TypeScript**, Tailwind CSS, deployed on **Vercel** (free tier).
- **Supabase**: Postgres, Auth, Realtime, RLS (free tier). Local dev via `npx supabase` CLI.
- **Auth:** **Discord** OAuth, plus an email magic link. Each user has a display name and an optional GEM ID.
  - **Production is Discord-only for now:** the email form shows only when `NEXT_PUBLIC_ENABLE_EMAIL_LOGIN=true` (set in `.env.local`, unset on Vercel), until a custom SMTP provider is configured.
  - **Stray login codes:** the middleware forwards any `?code=` on a non-callback page to `/auth/callback` (a safety net for Supabase's Site URL fallback).
  - **Discord via the phone app:** the login page prepares a direct `discord.com/oauth2/authorize` link on load: the browser client's `signInWithOAuth({ skipBrowserRedirect })` stores the PKCE verifier, and the `resolveDiscordAuthorizeUrl` server action follows Supabase's redirect one hop (URL checks in `src/lib/discord-auth.ts`). A tap on a direct link lets phones open the Discord app; a redirect wouldn't. It falls back to the normal redirect when the link isn't ready or is older than 4 minutes, and always in the installed PWA (where the handoff would return to the browser instead).
  - **`prompt=none`** is sent on every Discord sign-in, so returning players skip Discord's Authorize screen.
  - **Came back in another browser:** the Discord app returns to the phone's default browser. If that browser lacks the code verifier, `/auth/callback` sends `/login?error=other_browser`, which asks the player to sign in once more there.
  - **Live site:** https://armorypal.vercel.app (Supabase project `hlfjqfwiotpvbjrslrnn`).
- **PWA:** Serwist (`@serwist/next`) + web manifest.
- **Dates:** `@date-fns/tz`. Schedules are store-local (IANA timezone on the store).
- **Tests:** Vitest. Unit tests for pure rules, plus integration tests for RPCs/RLS against local Supabase.
  - **End-to-end and security:** Playwright in `e2e/` (see `e2e/README.md`). It runs nightly, on PRs and weekly with AI exploration through `.github/workflows/`. New UI flows get a test in `e2e/functional/`, and new attack surfaces get one in `e2e/security/`.

## Key decisions
- **Card model = name + pitch.** Requests reference a single card (one row per unique name+pitch). Printing, foil, and set preferences go in the free-text note.
- **Card data** comes from [the-fab-cube/flesh-and-blood-cards](https://github.com/the-fab-cube/flesh-and-blood-cards) `json/english/card.json`.
  - **Pinned release:** `DATASET_TAG` in `scripts/import-cards.mts` (currently v8.2.0). After a new set releases, bump it and re-run.
  - **Import behavior:** the upsert is idempotent and keyed on `unique_id`. That ID is a nanoid-style string, not a UUID, so `cards.id` is `text`.
  - **Everything is imported, including tokens** (players borrow those often). Cards are never deleted because requests reference them.
  - **What's stored:** name, pitch (1–3 or null), color, types and image_url. `(name, pitch)` is unique (`nulls not distinct`).
  - **`set_ids`:** the set codes the card was printed in, ordered by `cardSetIds()` in `src/lib/cards.ts`:
    1. Regular sets, newest release first (dates from `set.json`).
    2. Undated regular sets (promos).
    3. **Armory Deck** and **Silver Age** decks at the back (`setInfo().isDeck`, matched by name prefix), newest first, undated last. Request rows show the 5 newest via `formatSetIds()`, and the pledge sheet shows all of them.
  - **License:** the dataset's README says "feel free to … use it for whatever projects you like". There's no formal license, so we credit it in the UI.
  - **After `db reset`:** the cards table is empty. Run the import again.
  - **Latest set:** the import also reads `set.json` and writes the one-row `catalog_meta` table: the dataset tag plus the **latest expansion**. That's the most recently released set with ≥ 150 distinct cards (`EXPANSION_MIN_CARDS`); the threshold keeps Armory decks, demo decks, Silver Age decks and mastery packs from counting. The UI shows "Includes cards up to <set>".
  - **Offline import:** `--dir <folder>` imports from local `card.json` and `set.json` files instead of downloading.
- **Card search** goes through the `search_cards(q, max_results)` RPC, using pg_trgm.
  - **Ranking:** card names are ranked exact match, then prefix, then substring, then typo matches (word_similarity ≥ 0.45, tie-broken by strict_word_similarity). LIKE wildcards are escaped.
  - **Limits:** `max_results` counts **distinct names**. Every pitch variant of each top name is returned together, in pitch order.
- **Card picker UX** (`src/components/card-autocomplete.tsx`): results show **one entry per name**, with dots for the colours it comes in. Picking a name with several colours then shows **toggle buttons**, so you can pick one or more colours (e.g. red + yellow + blue). `onSelect` receives `CardRow[]` in pitch order. Single-version cards (heroes, equipment, tokens, one-colour cards) are selected immediately. `groupCards()` in `src/lib/cards.ts` does the grouping.
  - In Phase 4, each selected colour becomes **its own request line**, with its own quantity and its own pledges and status. A request always references exactly one card.
- **Paste-list import** (the add-request sheet's "Paste list" tab):
  - **Parsing:** `parseCardList()` in `src/lib/card-import.ts` accepts `3 Name`, `3x Name`, `Name x3` or a bare name (= 1), with optional `(Blue)`, `[b]` or `- blue`. It ignores blanks, `#`/`//` comments and bullets.
  - **Lookup:** the `resolve_card_names(names[])` RPC matches on `card_name_key()` (lowercase, no punctuation) first, then a trigram typo match (≥ 0.5, indexed). It handles up to 200 names per call.
  - **Colour:** `chooseVariant()` defaults multi-colour cards to **Red**, or the lowest pitch if there's no red.
  - **Preview:** `buildImportPreview()` sums duplicates (capped at 20) and lists skipped lines with a reason.
  - **Writing:** the server action `previewCardImport()` writes nothing. Confirming sends **one** `add_requests` call, so there's one notification.
- **Stores can have multiple weekly schedules** (`store_schedules`). Each schedule produces one `events` row per week, created lazily. Admins (`profiles.is_admin`) create stores and schedules.
- **Events become read-only after `ends_at`** (end of the event day in the store's timezone). Every write RPC rejects them via `assert_event_open`, and the UI hides actions and live updates.
- **History** (`/stores/[id]/history`) lists past events newest first, 20 per page, with went and covered counts. Ended event pages link back to it.
- **Copying requests forward:** `copy_open_requests(from_event, to_event)` copies the caller's still-needed requests into this week's event.
  - **From where:** last week's ended event of the **same weekly slot**, only. The caller must be attending this week's event.
  - **What:** only the **remaining** quantity (requested minus pledged). Copies merge with existing requests for the same card.
  - **Idempotent:** each copy records `copied_from_id`, so running it twice doesn't copy twice. It sends one `new_requests` notification.
  - **Banner:** the TS mirror `copySummary()` in `src/lib/rollover.ts` and `getCopyCandidate()` in `src/lib/event-data.ts` drive it. "Not now" is remembered per device in localStorage.
- **Which event is current** is decided by SQL `public.event_occurrence(weekday, start_time, tz, now)`: the next `weekday` in store-local time, counting today until local midnight. Its TS mirror is `currentEventFor()` in `src/lib/events.ts`. **Change both together.** `tests/db/events.test.ts` checks that they agree across DST changes, offsets and year boundaries.
- **Events are created lazily** by the `current_events_for_stores(store_ids)` RPC, which is idempotent and called on page views. Users can't insert events. Server code uses `getCurrentEvents()` in `src/lib/event-data.ts`.
- **Attendance** goes only through the `attend_event` / `leave_event` RPCs, which reject ended events via the internal `assert_event_open`. The table has no write policies. Attendee lists are visible to all signed-in users.
- **FKs to schedules and stores from events are `on delete restrict`.** Schedules get deactivated, never deleted.
- **Requests and pledges** (migration `*_requests_pledges.sql`) are written only through RPCs:
  - **RPCs:** `add_requests(event, items jsonb, note)`, `update_request`, `cancel_request`, `pledge(request, qty)` and `unpledge`.
  - **Error codes:** the RPCs raise short codes as the message (`not_attending`, `own_request`, `exceeds_remaining`, `below_pledged`, `event_ended`, …). `ruleMessage()` in `src/lib/rules.ts` maps them to UI text, so add new codes in both places.
  - **Quantities:** 1–20 (`MAX_QUANTITY`). Notes are at most 200 chars.
  - **One active request per user, card and event.** `add_requests` adds to an existing request (capped at 20) and is all-or-nothing.
  - **Pledges:** one row per pledger per request. `pledge()` *replaces* the caller's quantity, and locks the request row (`FOR UPDATE`) so concurrent pledges can't exceed the quantity.
  - **Cancelling a request** deletes its pledges. Requests are cancelled (`status`), never deleted.
  - **Leaving an event** (`leave_event`) deletes all of the leaver's pledges for that event, so those cards are needed again. See the Leaving and Notifications notes above for what else it does.
  - **Coverage** (open / partial / covered) is computed in TS (`coverage()`, `buildRequestViews()` in `src/lib/request-view.ts`), not stored.
- **Event page** (`/events/[id]?tab=going|requests|checklist`). Tabs appear in that order, and **Going is the default**. Going lists attendees in join order with their request counts (`buildPeopleList()`), followed by people who left but kept requests ("Not going"). The Requests tab orders others' unfilled requests, then mine unfilled, then others' filled, then mine filled (`listGroup()` in `request-view.ts`). "My checklist" shows cards I'm bringing above cards I need. The page is server-rendered, with client "sheets" in `src/components/event/*`. Server actions in `src/app/actions/requests.ts` are thin RPC wrappers that revalidate the page.
- **Home** (`/`) opens with `<NextArmoryCard>`: the soonest not-ended event I'm attending at **any** store (`getNextAttendingEvent()` in `src/lib/event-data.ts`), its going count, and the cards I pledged to bring (`summarizeBringing()` in `request-view.ts`). It live-refreshes on that event's topic. "My stores" follows below.
- **Rules are enforced in the database**: writes with rules go through `security definer` RPCs that lock the request row (`FOR UPDATE`), and RLS blocks direct writes. The same rules are mirrored as pure functions in `src/lib/rules.ts` for UI feedback, and **both are tested**.
  - Only attendees of a non-past event can add requests or pledges.
  - You can't pledge on your own request.
  - 1 ≤ pledge quantity ≤ remaining (plus your existing pledge). One pledge row per user per request, and its quantity is editable.
  - A request's quantity can't be lowered below what's already pledged.
  - Leaving an event asks whether to cancel your requests and pledges. Affected users get in-app `notifications`.
- **Realtime** uses **Broadcast from the database**, not `postgres_changes`. `postgres_changes` can't filter DELETE events by `event_id`, and un-pledging, leaving and cancelling all delete rows.
  - **Event topic:** statement-level triggers on `attendances`, `requests` and `pledges` call `realtime.send(…, 'change', 'event:<id>', private)`. That's one message per event per SQL statement, carrying just `{table, op}`.
  - **User topic:** a trigger on `notifications` sends `'notification'` to `user:<id>`.
  - **Who can listen:** RLS on `realtime.messages` lets any signed-in user receive `event:*`, but only the owner receives `user:<id>`.
  - **Client:** `<RealtimeRefresh topic event>` (`src/components/realtime-refresh.tsx`) calls `router.refresh()`, debounced. Broadcast is at-most-once, so it also refreshes after a reconnect and on `visibilitychange`.
- **Notifications** (`notifications` table) are in-app only for now. Push could later deliver the same rows.
  - **Writing:** only SQL functions write them, via the internal `notify()`. Payloads are rendered by `formatNotification()` in `src/lib/notifications.ts`. Kinds:
    - `pledge_released`: someone un-pledged or left.
    - `request_cancelled`: the requester cancelled, or left with "cancel my requests".
    - `new_requests`: **one** per `add_requests` call, sent to each other attendee. Payload is `{actor, card, items, copies}`.
    - `requests_filled`: sent when a pledge covers the requester's *last* unfilled request on the event. It fires on that transition only. `pledge()` locks all of the requester's requests on the event in id order so concurrent pledges can't miss or duplicate it, and `leave_event` uses the same lock order.
  - **Adding a kind:** update the SQL check constraints (on `notifications` and `notification_preferences`) and `NOTIFICATION_KINDS` in `src/lib/notifications.ts` together.
  - **Preferences** live in `notification_preferences` (user, kind, enabled). A missing row means on. `notify()` skips disabled kinds, so they're never stored. The settings page is `/settings/notifications`, linked from the inbox and `/me`.
  - **Reading:** users read only their own. `/notifications` marks them read (`mark_notifications_read()`), and the bell (`NotificationBell`) shows the unread count live.
- **Leaving an event:** `leave_event(event, cancel_requests)` always releases your pledges and notifies the requesters. Cancelling your requests is optional (the UI checkbox is on by default) and notifies their pledgers. Kept requests show a "Not going" badge.

- **PWA:** the service worker `src/app/sw.ts` is built by `@serwist/next` into `public/sw.js`. That file is git-ignored, and the worker is disabled in dev.
  - **Caching:** **only static assets** (`/_next/static`, images, fonts) are cached. Pages, RSC payloads, server actions and Supabase calls are **NetworkOnly**, because they're per-user and live. Offline navigations show `/~offline`. Don't add page caching.
  - **Manifest and icons:** `src/app/manifest.ts`. Icons are generated with `next/og` from `src/lib/app-icon.tsx` (`/icons/*.png`, `/icon`, `/apple-icon`). They and `/~offline` are public (middleware matcher and `PUBLIC_PATHS`).
  - **Install hint:** `<InstallHint>` on Home, using `beforeinstallprompt` on Android and Share instructions on iOS.
- **Deploying:** see `DEPLOY.md`. The scripts accept `--env .env.production.local` and print their `Target:` URL. Vercel only needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the secret key never goes to Vercel.
- **Grants are explicit** (`*_explicit_api_grants.sql`). Production doesn't auto-grant API roles access to new tables or functions, so **every new table or RPC needs its own `grant` in its migration**: `select` (plus the exact writes) for `authenticated`, `execute` for RPCs, and `all` for `service_role`. `anon` gets nothing. To reproduce production locally, revoke all from `anon`/`authenticated`/`service_role`/`public` on `public` tables and functions, re-run that migration, then run `npm run test:db`.
- **Security baseline:** every public table has RLS. `next.config.ts` sets X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy on every response (no CSP yet). No security-definer function is executable by `anon`; check this after adding functions. Internal helpers revoke `execute` from `authenticated` too.

## Data model (summary)
`profiles`, `stores`, `store_schedules`, `user_stores`, `events`, `cards`, `attendances`, `requests`, `pledges`, `notifications`, and view `request_status` (pledged / remaining / open|partial|covered). Migrations live in `supabase/migrations/`, seed data in `supabase/seed.sql`.

## Out of scope (for now)
Trading/pricing, deck building, payments, chat, push notifications.

## Build phases
0. Skeleton: Next.js, Tailwind, Vitest, local Supabase, magic link + Discord login, onboarding
1. Stores: search, store page, admin CRUD, seed
2. Cards: import script, `search_cards` RPC (pg_trgm), autocomplete
3. Events & attendance: `currentEventFor()` (tested for timezones and DST), attend/leave
4. Requests & pledges: RPCs, RLS, `rules.ts`, tests, UI sheets
5. Realtime, leave flow, notifications inbox
6. Rollover & history: read-only past events, copy open requests
7. PWA + deploy (Supabase cloud, Discord OAuth app, Vercel)

## Commands (PowerShell)
```powershell
npm install
npx supabase start          # local Postgres/Auth/Realtime; Studio http://127.0.0.1:54323, Mailpit (magic-link emails) http://127.0.0.1:54324
npx supabase status         # shows local URL + publishable/secret keys for .env.local (see .env.example)
npx supabase migration up --local   # apply new migrations, keeping local users/data
npx supabase db reset       # wipe and re-apply migrations + seed (deletes local accounts!)
npm run db:types            # regenerate src/lib/supabase/database.types.ts after a migration
npm run dev                 # http://localhost:3000
npm test                    # unit tests (Vitest, src/**/*.test.ts)
npm run typecheck; npm run lint
npm run test:db             # RLS/RPC integration tests against local Supabase (tests/db/**)
npm run test:e2e            # Playwright: builds + starts the app, phone/desktop/security (local Supabase only)
npm run audit:check         # dependency audit with the accepted-advisory allowlist
npm run db:seed-dev         # local test players Alice/Bob/Carol + a current event with requests and pledges (after import-cards)
npx tsx scripts/make-admin.mts you@example.com [--revoke] [--env .env.production.local]
npx tsx scripts/import-cards.mts [--env .env.production.local]
npm run build; npm start    # production build incl. service worker (stop `npm run dev` first: both use .next)
```

- Node scripts in `scripts/` use the `.mts` extension (the package isn't `"type": "module"`, and the scripts use top-level await). They read `.env.local` through dotenv.
- `supabase/seed.sql` holds the **real New York area stores** running a weekly FaB Armory, with their slots (America/New_York). Addresses are left empty until verified.
- **Local testing as several players:** `npm run db:seed-dev` creates Alice, Bob and Carol (`src/lib/dev-users.ts`). In `next dev` against a local Supabase only (`devLoginEnabled()`), the login page shows a **Dev sign-in** box to sign in as each one in one tap (`devSignIn` in `src/app/actions/dev.ts`, which 404s anywhere else). Use a second browser or a private window for a second player. Local Discord login also works while `npx supabase start` is running.
- DB tests: `tests/db/helpers.ts` provides `createTestUser({ isAdmin })`, which returns a client signed in as that user, and `deleteTestUsers()` for cleanup. Add a DB test for every new RLS policy or RPC rule.

Gotcha: in Windows PowerShell 5.1, `Out-File -Encoding utf8` writes a BOM. Don't use it to write `.env*` files. Use `[IO.File]::WriteAllText` or the Write tool instead.

## Code layout
- `src/lib/supabase/{client,server,middleware,env}.ts`: Supabase clients (`@supabase/ssr`). Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, plus the server-only `SUPABASE_SECRET_KEY`.
- `src/middleware.ts`: refreshes the session and redirects signed-out users to `/login`.
- `src/lib/auth.ts`: `requireProfile()` for pages (redirects to `/login` or `/welcome`) and `safeNext()` to guard `?next=`.
- `src/lib/auth.ts` also has `requireAdmin()` (returns a 404 for non-admins) and `isUuid()`. Check route params with `isUuid()` before querying.
- `src/app/actions/*`: server actions. `src/components/*`: shared components (`admin/` holds admin-only forms).
- **Signed-in pages live in the `src/app/(app)/` route group**, whose layout calls `requireProfile()` (cached per request with React `cache()`) and renders the app bar. URLs are unchanged. `login`, `welcome`, `~offline`, `auth` and the icon routes stay outside it, so the root layout stays cookie-free and `/~offline` stays static. New signed-in pages go in `(app)`.
- Pure validation and formatting helpers go in `src/lib/*.ts`, with matching `*.test.ts`. Example: `src/lib/stores.ts` has `parseStoreInput`, `parseScheduleInput` and `formatSchedule`, and its checks mirror the DB constraints.
- Admin authorization lives in RLS via `public.is_admin()`. Server actions call `requireAdmin()` only to fail fast.
- Store schedules are deactivated, never deleted, so past events keep their history.
- **Store search** goes through the `search_stores(q)` RPC (latest version in `*_search_stores_order.sql`).
  - **Match tiers:** 0 exact name/city, 1 name/city or a word in them starts with the query, 2 contains it, 3 typo match.
  - **Within a tier:** the store's **earliest active slot, Monday first**, then start time, then name. Stores without a slot go last.
  - **Empty query:** lists all stores Monday → Sunday.
  - **Wildcards:** LIKE wildcards are escaped. The function returns `s.*`, so new store columns flow through.
- **Store notes:** `stores.notes` holds free text up to 500 chars (`MAX_STORE_NOTES`), e.g. "Pre-register at …". Admins edit it in the store form. `<StoreNotes>` shows it on the store page and on open event pages.
- Discord login is configured in `supabase/config.toml` (`[auth.external.discord]`, disabled until a Discord app exists). The secret goes in `supabase/.env`.

## Conventions
- Mobile-first UI: design for ~375px wide first, with large tap targets and bottom sheets for forms.
- **Navigation:** every signed-in page shows `<AppBar>` (`src/components/app-bar.tsx`): the burger `<NavMenu>` (a left drawer; add new sections to `SECTIONS` there), the **ArmoryPal wordmark in Cinzel** (`font-logo`) linking Home, the bell and the profile chip. Below it, `<PageHeader title trail>` renders a **breadcrumb trail** from Home (`trail` = the ancestors between Home and this page), which replaces back arrows. Home has no PageHeader.
- **Colours come from the Expo 2025 Osaka design system palette** (Inochi, Umi, Noyama and Hikari), defined as tokens in `src/app/globals.css` with light and dark values.
  - **Everything interactive uses the Noyama scheme:**
    - `accent` (green `#99C41E`, with dark `accent-foreground`; white on it fails AA) for primary buttons, the active tab and switches.
    - `accent-soft` (pale green) for secondary-button outlines.
    - `accent-text` (deepened green) for **link text**. Never use `text-accent` for text: the fill green is only 2:1.
    - `highlight` / `highlight-foreground` (lime) for selected states and the "You're going" badge.
    - `store*` (teal `#00A59E`) for stores.
    - Input focus uses `accent-text`, since `accent` is too faint to read as an outline.
  - **Other tokens:** `danger`, `live`, `pitch-red/yellow/blue` and `chip-{open,partial,covered}-{bg,fg}`.
  - **Colour meanings:** green means actions, lime means selected, teal means stores, red/yellow/blue mean pitch, and warm-to-green means request status.
  - **Store links:** anywhere a store name links somewhere, render it with `<StoreLink>` (`src/components/store-link.tsx`), never plain text. `StoreCard` wraps it for search results. Pass a store's events as `children`, so they render inside the store's tile as `EventCard` rows instead of below it.
  - **Use the tokens** (`bg-accent`, `text-danger`, `bg-chip-open-bg` …), never raw Tailwind colours like `bg-red-600`.
  - **Text colours must meet WCAG AA (4.5:1).** Text shades may be deepened from the palette hue to get there; dots and borders use the exact palette values.
- Keep business rules out of components. Put them in `src/lib/rules.ts` and the matching SQL RPC, and change both together.
- Every schema change is a new migration file. Never edit an applied migration.
