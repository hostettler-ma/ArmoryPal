# Deploying ArmoryPal

Production = **Supabase** (database, auth, realtime) + **Vercel** (the Next.js app). Both free tiers are enough for a
local-scene user base. All commands are **PowerShell**, run from the repo root.

> Free-tier notes: a Supabase free project **pauses after 7 days without activity** (weekly Armory traffic keeps it
> awake; un-pause from the dashboard if it happens) and has **no automatic backups**.

---

## 1. Create the Supabase project

1. https://supabase.com/dashboard → **New project**.
   - Region: **East US (North Virginia)** (closest to New York).
   - Set a **database password** and save it in your password manager.
2. Note the **project ref**: the 20-letter id in the dashboard URL / `https://<ref>.supabase.co`.

## 2. Push the schema and the store list

```powershell
npx supabase login                                   # opens the browser once
npx supabase link --project-ref <ref>                # asks for the database password
npx supabase db push --include-seed --dry-run        # preview: all migrations + seed.sql
npx supabase db push --include-seed                  # apply
```

`--include-seed` loads `supabase/seed.sql` (the New York stores). Use it **only this first time**; later schema
changes are just `npx supabase db push`.

## 3. Production keys and the card catalog

Dashboard → **Project Settings → API Keys**: copy the **publishable** key and the **secret** key.
Create `.env.production.local` (git-ignored; written without a BOM on purpose):

```powershell
[IO.File]::WriteAllText("$PWD\.env.production.local", @"
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SECRET_KEY=<secret key>
"@)
npx tsx scripts/import-cards.mts --env .env.production.local
```

The script prints `Target: https://<ref>.supabase.co` first. Check it's production before it continues.
The **secret key** stays on your machine: it is *not* needed on Vercel.

## 4. Push the code to GitHub

```powershell
git push origin main
```

## 5. Deploy on Vercel

1. https://vercel.com/new → **Import** `hostettler-ma/ArmoryPal` (framework: Next.js, defaults are fine).
2. **Environment Variables** (Production *and* Preview), set **before** the first deploy (they're baked into the build):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the publishable key
3. **Deploy**. Note the URL, e.g. `https://armorypal.vercel.app` (below: `<app-url>`).

## 6. Point Supabase auth at the app

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `<app-url>`, exactly the production domain (not a Vercel per-deployment URL, which is
  locked behind Vercel login)
- **Redirect URLs**: add `<app-url>/**` (the wildcard is needed: the app returns to `/auth/callback?next=…`)

## 7. Discord login

1. https://discord.com/developers/applications → your app (or a new "ArmoryPal" one) → **OAuth2 → Redirects** → add
   `https://<ref>.supabase.co/auth/v1/callback` (keep the local `http://127.0.0.1:54321/...` one for development).
2. Supabase dashboard → **Authentication → Sign In / Providers → Discord**: enable, paste the Client ID and Client Secret.

### Google login (optional, hidden until set up)

"Continue with Google" shows only when `NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=true`.

1. https://console.cloud.google.com → create a project "ArmoryPal".
2. **APIs & Services → OAuth consent screen**: External, app name ArmoryPal, your support email, scopes
   `openid`, `email`, `profile` (non-sensitive, so no Google review). Then **Publish app**: in "Testing" only
   listed test users can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*, with
   **Authorized redirect URIs**:
   - `https://<ref>.supabase.co/auth/v1/callback`
   - `http://127.0.0.1:54321/auth/v1/callback` (local development)
4. Supabase dashboard → **Authentication → Sign In / Providers → Google**: enable, paste the Client ID and Client Secret.
5. Vercel → **Settings → Environment Variables** → `NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN` = `true` (Production), then **Redeploy**
   (it's baked in at build time).

Players who use Discord and Google with the **same email** end up on the same account (Supabase links verified emails).

Locally: put the two values in `supabase/.env` as `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, set `enabled = true` under `[auth.external.google]` in `supabase/config.toml`,
add `NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=true` to `.env.local`, then `npx supabase stop; npx supabase start`.

### Connecting Discord to an existing account (manual linking)

Profile → **Connected accounts** lets a player who signed in another way connect (and later disconnect) Discord,
which ArmoryBot needs. It uses Supabase's `linkIdentity()`, which only works with **manual linking** on:

1. Supabase dashboard → **Authentication → Sign In / Providers** → turn on **Allow manual linking**
   (Supabase still labels it beta). Without it, Connect shows "Connecting accounts isn't turned on yet."
2. Nothing else: it reuses the Discord provider and the `/auth/callback` redirect URL from above.

Locally it's `enable_manual_linking = true` under `[auth]` in `supabase/config.toml` (already set). Config changes
need `npx supabase stop; npx supabase start`.

A Discord account that already has its own ArmoryPal account can't be connected to a second one (Supabase returns
`identity_already_exists`; the page explains it). Merging two accounts isn't supported yet.

## 8. Email (magic links): off at launch

ArmoryPal launched **Discord-only**: the email form is hidden unless `NEXT_PUBLIC_ENABLE_EMAIL_LOGIN=true`.
Supabase's built-in email sends **just a few emails per hour**, so it isn't usable for players. To turn email on later:

1. Dashboard → **Authentication → Emails → SMTP Settings** → enable custom SMTP with a provider such as Resend,
   Postmark, or Brevo (free tiers). You'll need a domain you control for the sender address.
2. Vercel → Project → **Settings → Environment Variables** → add `NEXT_PUBLIC_ENABLE_EMAIL_LOGIN` = `true`
   (Production), then **Redeploy** (it's baked in at build time).

## 9. Make yourself admin

Sign in once on `<app-url>`, then:

```powershell
npx tsx scripts/make-admin.mts you@example.com --env .env.production.local
```

## 10. Smoke test (on your phone)

- [ ] Sign in with Discord (and magic link, once SMTP is set up); set your display name.
- [ ] Add a store, open this week's event, mark yourself going.
- [ ] On a second phone/account: request a card on one, pledge on the other. Both update **live**.
- [ ] Bell shows a notification; leaving the event releases pledges.
- [ ] Install: iPhone Safari → Share → **Add to Home Screen**; Android Chrome → **Install**. Opens full-screen
      with the green card icon.
- [ ] Turn on airplane mode and reload: the "You're offline" page appears.

## 11. ArmoryBot (Discord bot)

ArmoryBot runs as Supabase Edge Functions; nothing goes to Vercel. Its secrets live only in Supabase. Design: `docs/armorybot.md`.

Use the **same Discord application** as Discord login (step 7). Adding a bot doesn't change the OAuth login.

1. **Developer portal → Bot:** **Reset Token** and copy it (you can't see it again). No privileged intents are needed.
2. **Developer portal → Installation:**
   - Installation contexts: **Guild Install** only (untick User Install).
   - Default install settings: scopes `bot` and `applications.commands`.
   - Permissions: **View Channels**, **Send Messages**, **Embed Links**, **Read Message History**.
3. **Secrets file:** create `supabase/functions/.env.production` (git-ignored) from `supabase/functions/.env.example`, with:
   - the **production** App ID and Public Key (General Information),
   - the bot token,
   - `ARMORYPAL_URL=https://armorypal.vercel.app`,
   - a new random `DISCORD_WORKER_SECRET` (the file shows how to generate one).
   Then `npx supabase db push` to apply the ArmoryBot migrations (they enable `pg_net` and schedule the worker).
4. **Push the secrets and deploy:**
   ```powershell
   npx supabase secrets set --env-file supabase/functions/.env.production --project-ref hlfjqfwiotpvbjrslrnn
   npx supabase functions deploy discord-interactions --project-ref hlfjqfwiotpvbjrslrnn
   npx supabase functions deploy discord-worker --project-ref hlfjqfwiotpvbjrslrnn
   ```
   `verify_jwt = false` comes from `supabase/config.toml`: Discord's signature, and the worker's shared secret, are the auth.
5. **Wake the worker:** in the Supabase dashboard → SQL Editor, store where pg_cron/pg_net call the worker, and with which secret
   (the same `DISCORD_WORKER_SECRET` value):
   ```sql
   select vault.create_secret('https://hlfjqfwiotpvbjrslrnn.supabase.co/functions/v1/discord-worker', 'discord_worker_url');
   select vault.create_secret('<DISCORD_WORKER_SECRET>', 'discord_worker_secret');
   ```
   Until both exist, nothing calls the worker: no posts, no edits. To rotate the secret, run `supabase secrets set` and
   `select vault.update_secret((select id from vault.secrets where name = 'discord_worker_secret'), '<new>');`.
   **Check it runs:** Edge Functions → discord-worker → Logs shows a `discord-worker {...}` line every minute.
6. **Developer portal → General Information → Interactions Endpoint URL:**
   `https://hlfjqfwiotpvbjrslrnn.supabase.co/functions/v1/discord-interactions` → **Save Changes**.
   Discord checks the endpoint first (a signed PING, plus a badly signed one that must get 401). If saving fails, check that the Public Key secret matches this app.
7. **Register the slash commands:**
   ```powershell
   npx tsx scripts/register-discord-commands.mts --env supabase/functions/.env.production
   ```
   It prints `Target: Discord app …`. Global commands can take a few minutes to appear.
8. **Invite link and setup guide:** the public page `/discord-bot` explains setup to server admins and store owners,
   with an **Add ArmoryBot to Discord** button. The button needs the (public, non-secret) application ID on Vercel:
   Project → **Settings → Environment Variables** → `NEXT_PUBLIC_DISCORD_CLIENT_ID` = the App ID (Production), then
   **Redeploy** (it's baked in at build time). Without it the page asks people to email for the link.
   The link itself (permissions 84992 = the four above):
   `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=84992`
9. **Smoke test:**
   - In a test server: `/armory link-store` (you need Manage Server in that Discord server; store owners and admins without it can still link with Discord connected on their Profile).
   - Then `/armory status`.
   - With `days_before` covering the next event, the post appears within a minute. Tap Going, and the post updates a few seconds later.

Re-run steps 4 and 7 after changing the functions or the commands.

---

## Ongoing

| Task | Command |
|---|---|
| Schema change | add a migration in `supabase/migrations/`, then `npx supabase db push` |
| New FaB set released | bump `DATASET_TAG` in `scripts/import-cards.mts`, then `npx tsx scripts/import-cards.mts --env .env.production.local` |
| Grant/revoke admin | `npx tsx scripts/make-admin.mts <email> [--revoke] --env .env.production.local` |
| Deploy app changes | `git push origin main` (Vercel deploys automatically) |
