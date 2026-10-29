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

---

## Ongoing

| Task | Command |
|---|---|
| Schema change | add a migration in `supabase/migrations/`, then `npx supabase db push` |
| New FaB set released | bump `DATASET_TAG` in `scripts/import-cards.mts`, then `npx tsx scripts/import-cards.mts --env .env.production.local` |
| Grant/revoke admin | `npx tsx scripts/make-admin.mts <email> [--revoke] --env .env.production.local` |
| Deploy app changes | `git push origin main` (Vercel deploys automatically) |
