# ArmoryPal

Mobile-first companion PWA for the Flesh and Blood TCG. Players coordinate card loans around their store's weekly Armory event: attendees list cards they need, other attendees pledge to bring them, and everyone viewing the event sees changes in real time.

## Environment
- The developer is on Windows using PowerShell in Zed. **Give PowerShell commands, not bash** (use `;` / `if ($?) { }`, not `&&`).
- Node 20+, Docker Desktop (needed for local Supabase).

## Stack (agreed)
- **Next.js 15 (App Router) + TypeScript**, Tailwind CSS, deployed on **Vercel** (free tier).
- **Supabase**: Postgres, Auth, Realtime, RLS (free tier). Local dev via `npx supabase` CLI.
- **Auth:** email magic link + **Discord** OAuth. Each user has a display name and an optional GEM ID.
- **PWA:** Serwist (`@serwist/next`) + web manifest.
- **Dates:** `@date-fns/tz`. Schedules are store-local (IANA timezone on the store).
- **Tests:** Vitest. Unit tests for pure rules, plus integration tests for RPCs/RLS against local Supabase.

## Key decisions
- **Card model = name + pitch.** Requests reference a single card (one row per unique name+pitch). Printing, foil, and set preferences go in the free-text note.
- **Card data** comes from [the-fab-cube/flesh-and-blood-cards](https://github.com/the-fab-cube/flesh-and-blood-cards) `json/english/card.json`, **pinned to a release tag**. Import with `scripts/import-cards.ts` (idempotent upsert keyed on `unique_id`). We store name, pitch, color, types, and image_url only. Check the dataset's license and add attribution before going public.
- **Stores can have multiple weekly schedules** (`store_schedules`). Each schedule produces one `events` row per week, created lazily. Admins (`profiles.is_admin`) create stores and schedules.
- **Events become read-only after `ends_at`** (end of the event day in the store's timezone). Open requests can be copied to the next week's event.
- **Rules are enforced in the database**: writes with rules go through `security definer` RPCs that lock the request row (`FOR UPDATE`), and RLS blocks direct writes. The same rules are mirrored as pure functions in `src/lib/rules.ts` for UI feedback, and **both are tested**.
  - Only attendees of a non-past event can add requests or pledges.
  - You can't pledge on your own request.
  - 1 ≤ pledge quantity ≤ remaining (plus your existing pledge). One pledge row per user per request, and its quantity is editable.
  - A request's quantity can't be lowered below what's already pledged.
  - Leaving an event asks whether to cancel your requests and pledges. Affected users get in-app `notifications`.
- **Realtime:** Supabase Realtime `postgres_changes` on `attendances`, `requests`, and `pledges`, filtered by `event_id` (pledges carry a denormalized `event_id` for this).
- **Notifications** are in-app rows for now. Design them so push can be added later as another delivery channel.

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
npx tsx scripts/make-admin.mts you@example.com [--revoke]
npx tsx scripts/import-cards.mts
```

- Node scripts in `scripts/` use the `.mts` extension (the package isn't `"type": "module"`, and the scripts use top-level await). They read `.env.local` through dotenv.
- `supabase/seed.sql` holds **fictional** sample stores only, for local dev.
- DB tests: `tests/db/helpers.ts` provides `createTestUser({ isAdmin })`, which returns a client signed in as that user, and `deleteTestUsers()` for cleanup. Add a DB test for every new RLS policy or RPC rule.

Gotcha: in Windows PowerShell 5.1, `Out-File -Encoding utf8` writes a BOM. Don't use it to write `.env*` files. Use `[IO.File]::WriteAllText` or the Write tool instead.

## Code layout
- `src/lib/supabase/{client,server,middleware,env}.ts`: Supabase clients (`@supabase/ssr`). Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, plus the server-only `SUPABASE_SECRET_KEY`.
- `src/middleware.ts`: refreshes the session and redirects signed-out users to `/login`.
- `src/lib/auth.ts`: `requireProfile()` for pages (redirects to `/login` or `/welcome`) and `safeNext()` to guard `?next=`.
- `src/lib/auth.ts` also has `requireAdmin()` (returns a 404 for non-admins) and `isUuid()`. Check route params with `isUuid()` before querying.
- `src/app/actions/*`: server actions. `src/components/*`: shared components (`admin/` holds admin-only forms).
- Pure validation and formatting helpers go in `src/lib/*.ts`, with matching `*.test.ts`. Example: `src/lib/stores.ts` has `parseStoreInput`, `parseScheduleInput` and `formatSchedule`, and its checks mirror the DB constraints.
- Admin authorization lives in RLS via `public.is_admin()`. Server actions call `requireAdmin()` only to fail fast.
- Store schedules are deactivated, never deleted, so past events keep their history.
- Discord login is configured in `supabase/config.toml` (`[auth.external.discord]`, disabled until a Discord app exists). The secret goes in `supabase/.env`.

## Conventions
- Mobile-first UI: design for ~375px wide first, with large tap targets and bottom sheets for forms.
- Keep business rules out of components. Put them in `src/lib/rules.ts` and the matching SQL RPC, and change both together.
- Every schema change is a new migration file. Never edit an applied migration.
