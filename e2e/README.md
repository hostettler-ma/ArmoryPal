# End-to-end and security tests

Browser tests (Playwright) that click through ArmoryPal like real players, plus attacks against it. They run every night in GitHub Actions (`.github/workflows/nightly.yml`), on every pull request, and locally on demand.

| Folder | What it checks |
|---|---|
| `functional/` | Sign-in (magic link through Mailpit), onboarding and profile fields, stores, admin, the full request → pledge → leave loop with **two players live at once**, the paste-list import, quantity limits. It also has a crawler that opens every linked page. Runs on a phone (Pixel 7) and a desktop screen. |
| `security/` | Signed-out access (pages and the whole database API, checked against **production-style grants**), one user tampering with another's requests, pledges, profile, notifications and realtime channel, admin escalation, XSS in every text field, SQL and LIKE injection in search, open redirects, security headers, and secrets in the JS bundle. |
| `prod/` | Read-only smoke checks against the live site. They never sign in or write. |

The nightly run also does:
- a signed-in **OWASP ZAP** full scan of the local copy (rules to ignore are in `.github/zap-rules.tsv`);
- a **dependency audit** (`npm run audit:check`; accepted advisories with reasons are in `.github/audit-allowlist.json`);
- the existing unit and DB tests.

If anything fails, the run opens a `nightly-failure` issue and comments on it each night until a green run closes it. Every run uploads screenshots, videos and traces (artifact **nightly-report**).

Once a week, `.github/workflows/weekly-ai-explore.yml` has Claude explore a throwaway copy in two browsers and posts its findings as an `ai-exploration` issue.

## Running locally (PowerShell)

The local tests create users and run attack payloads, so they **only run against local Supabase**. `e2e/support/env.ts` refuses any other URL.

```powershell
npx supabase start
# .env.local as usual (see .env.example), with NEXT_PUBLIC_ENABLE_EMAIL_LOGIN=true
npx playwright install chromium        # once
npm run test:e2e                       # builds, starts the app, runs mobile + desktop + security
npx playwright test --project=security # just one group
npm run test:e2e:ui                    # watch it click through, step by step
npx playwright show-report             # after a run: screenshots, traces
```

To match production's database grants locally (the anonymous-access test expects them), run the following. `npx supabase db reset` undoes it.

```powershell
npx tsx e2e/support/prod-grants.mts | docker exec -i supabase_db_ArmoryPal psql -U postgres -d postgres -q
```

Live-site smoke checks:

```powershell
$env:E2E_TARGET="prod"; $env:PROD_BASE_URL="https://armorypal.vercel.app"; npx playwright test; Remove-Item Env:E2E_TARGET
```

## Writing tests

- `test` and `expect` come from `support/fixtures.ts`.
  - `newPlayer()` gives you a fresh signed-in user, with a browser tab (`.page`) and a Supabase client (`.db`). It's deleted after the test.
  - Any alert dialog or uncaught page error fails the test.
- Use the helpers in `support/ui.ts` (`openEvent`, `attend`, `pickCard`, `setQuantity`, `requestRow`, …), and select by role or label like a user would.
- Test data: the store `E2E Test Armory` and the cards `Zeetest Snatch` (red, yellow, blue) and `Zeetest Sledge`. These come from `support/global-setup.ts`.
- New tables and RPCs are picked up automatically by the anonymous-access check after `npm run db:types`.
