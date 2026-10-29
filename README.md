# ArmoryPal

A mobile-first companion app for **Flesh and Blood** players: coordinate card loans around your store's weekly
Armory. Say you're going, list the cards you need, and other attendees promise to bring them. Everyone sees the
same list, live.

- Next.js 15 + TypeScript + Tailwind, Supabase (Postgres, Auth, Realtime), installable PWA.
- Card data from [the-fab-cube/flesh-and-blood-cards](https://github.com/the-fab-cube/flesh-and-blood-cards).
- Unofficial fan project, not affiliated with Legend Story Studios.

## Local development (PowerShell)

```powershell
npm install
npx supabase start            # needs Docker Desktop
npx supabase status           # copy URL + keys into .env.local (see .env.example)
npx supabase db reset         # migrations + New York store seed
npx tsx scripts/import-cards.mts
npm run dev                   # http://localhost:3000
```

Tests: `npm test` (unit) and `npm run test:db` (against local Supabase).

Deploying: see [DEPLOY.md](DEPLOY.md). Project conventions: see [CLAUDE.md](CLAUDE.md).
