# Deploying TCGROI

The app is a Next.js 16 app in `apps/web`, backed by a Neon Postgres database,
with three scheduled data-refresh cron jobs. It builds cleanly and is ready to
deploy to Vercel. This guide lists what's already done and the steps only you
can do (creating accounts, pasting secrets, connecting the repo, the domain).

## What's already verified
- `npm run build -w @packroi/web` passes (45 set pages + 101 product pages
  pre-render at build; API + cron routes are dynamic).
- `vercel.json` defines the three cron schedules (prices daily, graded daily,
  catalog weekly).
- Cron endpoints (`/api/cron/*`) reject anything without `Authorization: Bearer
  <CRON_SECRET or ADMIN_SECRET>`.
- All catalog/price data is already loaded in the Neon database the local
  `.env.local` points at — a deploy that reuses that `DATABASE_URL` has data
  from the first request.

## One-time setup (your accounts — I can't create these or enter secrets)

1. **Neon** (database). You already have one (`DATABASE_URL` in `.env.local`).
   For production you can reuse it or create a fresh project. If fresh, run the
   migrations and seed against it (see "Database" below).
2. **Vercel** (hosting). Create an account and a new project.
3. **GitHub**: the repo is already at `github.com/YoungAppa/TCGroi`. In Vercel,
   "Import" that repo.

## Vercel project settings
- **Root Directory**: `apps/web` (it's a monorepo; this is important).
- **Framework preset**: Next.js (auto-detected).
- **Build command / install**: defaults are fine (`next build`; the monorepo
  install runs from the root).

## Environment variables (set these in Vercel → Settings → Environment Variables)
Copy the values from your `.env.local`. See `.env.example` for the full list and
notes. The important ones for production:

| Variable | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Your Neon connection string. |
| `ADMIN_SECRET` | yes | Long random string; guards `/admin` + manual refresh. |
| `CRON_SECRET` | yes (for cron) | Long random string. Vercel Cron sends it as a Bearer token; without it the scheduled refreshes 401. |
| `NEXT_PUBLIC_SITE_URL` | recommended | Your real domain, e.g. `https://tcgroi.com`. Drives canonical URLs, sitemap, OpenGraph. |
| `TCGPLAYER_MIRROR_PROVIDER` | if using Scrydex | Set to `scrydex` for One Piece + Magic + sealed. |
| `TCGPLAYER_MIRROR_API_KEY` + `SCRYDEX_TEAM_ID` | with Scrydex | Your Scrydex key + team id. |
| `PRICECHARTING_TOKEN` | optional | eBay-sold + sealed + Magic/OP/Chinese card prices. |
| `POKEPRICE_TOKEN` | optional | PSA 9/10 graded prices (enables graded mode). |
| `POKEMONTCG_IO_KEY` | optional | Raises the free Pokémon price API's rate limit. |

## Database (only if using a fresh Neon project)
From `apps/web`, with `DATABASE_URL` pointing at the new database:
```
npm run db:migrate        # apply drizzle/*.sql (incl. 0004 ZH language)
npm run db:seed           # games + price sources
npx tsx --env-file=.env.local scripts/load-pullrates-products.ts
# then the catalog/price/inventory build scripts as needed
```
If you reuse the existing database, skip this — the data is already there.

## Deploy
Push to `main` (or click Deploy in Vercel). Vercel builds `apps/web`, runs the
cron jobs on the `vercel.json` schedule, and serves the ISR pages (they
revalidate hourly).

## After the first deploy
- Hit `https://<your-domain>/` — the rankings should render.
- Manually trigger a refresh once to confirm the cron path works:
  `curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-domain>/api/cron/refresh-prices`
- Add your custom domain in Vercel → Settings → Domains, then update
  `NEXT_PUBLIC_SITE_URL` to match and redeploy.

## Notes
- Card images are hot-linked from external CDNs (Scryfall, pokemontcg.io,
  TCGdex) via plain `<img>` — no `next/image` remote config needed.
- The cron jobs are the ONLY place production calls external price APIs; pages
  never do. Keep `maxDuration` (300s) in mind on the Vercel plan you choose.
