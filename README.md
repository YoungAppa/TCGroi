# TCGROI

Expected value and ROI for sealed TCG products (Pokémon, One Piece), computed
from community pull rates × live market prices. Free, no accounts. The site's
recurring finding is its thesis: **opening sealed product is almost always
−EV, and this site shows exactly how much.**

(The npm workspace packages are still named `@packroi/*` — internal only; the
product is TCGROI.)

## Monorepo layout

```
apps/web        @packroi/web — Next.js site, DB layer, adapters, cron jobs, data files
packages/ev     @packroi/ev  — pure EV/ROI math engine (zero deps, zero I/O, 115 tests)
```

## Quick start

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # fill DATABASE_URL + ADMIN_SECRET
npm run db:migrate
npm run db:seed                                 # games + price-source registry
npx tsx --env-file=apps/web/.env.local apps/web/scripts/refresh-catalog.ts
npx tsx --env-file=apps/web/.env.local apps/web/scripts/refresh-prices.ts
npm run dev                                     # http://localhost:3000
```

The app **must** boot with only `DATABASE_URL` + `ADMIN_SECRET` set. Every
price source self-disables when unconfigured; CI builds in exactly that state.

`npm run verify` = typecheck + lint + all tests + pull-rate data validation.

## Architecture rules (non-negotiable)

- **No external API call ever happens in a page's request path.** Cron jobs
  write to Postgres; pages read Postgres via ISR. That's structural, not
  convention — the data layer has no fetch.
- **Never scrape TCGplayer or any site whose ToS forbids it.** This includes
  laundering scraped data through third parties (it's why optcgapi's prices
  are ignored while its catalog facts are used).
- **Pull rates are estimates and must look like estimates.** Confidence badge,
  sample size, and source citation render wherever the numbers do. Source
  disagreements are shown, not resolved silently.
- **Unknown ≠ zero.** An unpriced card is excluded from its tier average and
  surfaced as a coverage warning — never counted as $0.
- Money is integer cents end-to-end; expectations stay fractional internally
  and round once at display.

## Runbook

### Add a set

1. Research real community pull rates. A source must publish per-tier odds;
   a disclosed sample size is what separates `medium`/`high` from `low`.
2. Write `apps/web/data/pullrates/{game}/{setCode}.json`. The schema enforces
   honesty: `high` needs n≥500 disclosed, `medium` n≥100, undisclosed n caps
   at `low`, placeholders must have `sampleSizePacks: 0`. Record rival
   estimates in `alternateEstimates` — the product page renders the spread.
3. **Check the set's real tier structure first** (`rarity` distribution from
   the catalog API) — special sets differ (Prismatic Evolutions has no
   Illustration Rare tier; 151 has no ACE SPEC).
4. Add sealed products to `apps/web/data/products/{game}.json`. MSRP and pack
   counts are facts; `marketCents` needs `marketAsOf` + `marketSource` or the
   loader rejects it. Guaranteed promos go in `promos` by external card id.
5. `npm run check:pullrates`, then run refresh-catalog + refresh-prices, then
   `npm run verify`.

### Update pull rates for an existing set

Edit the JSON, **bump `version`**, commit. The loader keeps one active version
per set; history stays in the table. CI validates every file on every push.

### Add a price source

Implement `PriceSourceAdapter` (see `apps/web/src/lib/prices/`): `enabled()`
reads env and self-disables; adapters return plain data, jobs persist it.
Register in `registry.ts` and add a row in `sources.ts` (with the attribution
its ToS requires). If it's a TCGplayer mirror, implement the `MirrorProvider`
interface behind `tcgplayer_market` instead — the UI never learns which mirror
runs. **Write a probe script and verify the real response shape before
trusting a number** (see `probe-scrydex.ts` — two schema bugs and four data
patterns were caught only by hitting live APIs).

### Rotate / add API keys

| Env var | What |
| --- | --- |
| `DATABASE_URL` | Postgres (Neon). Required. |
| `ADMIN_SECRET` | /admin + manual cron trigger. Required. |
| `CRON_SECRET` | Set by Vercel for scheduled cron calls. |
| `TCGPLAYER_MIRROR_PROVIDER` | Pokémon mirror: `pokemontcg_io` (default, free) or `scrydex`. One Piece always uses Scrydex when its creds exist — per-game routing, so enabling OP never moves Pokémon onto the credit-metered plan. |
| `TCGPLAYER_MIRROR_API_KEY` | Scrydex API key. Starter ($29) = raw prices only — graded prices + PSA population need the Growth plan ($99). |
| `SCRYDEX_TEAM_ID` | Scrydex team id — both required for Scrydex. |
| `PRICECHARTING_TOKEN` | Optional. eBay-sold card + sealed prices, both games. This tier is ungraded-only — graded prices come from PokemonPriceTracker instead. |
| `POKEPRICE_TOKEN` | Optional. PokemonPriceTracker — PSA 10/9 graded prices (Pokémon only), used by the `refresh-graded` job for the grading section. Free tier = 100 credits/day. |
| `POKEMONTCG_IO_KEY` | Optional. Raises the pokemontcg.io rate limit; never required. |
| `BULK_THRESHOLD_CENTS` | Optional tunable (default 50) — cards under this count at the $0.01 bulk floor. |
| `AFFILIATE_TCGPLAYER_ID`, `AFFILIATE_EBAY_CAMPAIGN` | Optional affiliate ids. |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap/robots/OG (e.g. https://tcgroi.com). |

After adding a Scrydex key: run `apps/web/scripts/probe-scrydex.ts` FIRST and
reconcile `extractRawMarket()` with the real shapes. **Never commit a token —
they live in `.env.local` (gitignored) locally and in Vercel's env at deploy.**

### Deploy (Vercel)

1. Push to GitHub, import in Vercel.
2. **Set Root Directory to `apps/web`** in project settings.
3. Add env vars (table above), incl. `NEXT_PUBLIC_SITE_URL` and any tokens.
   `vercel.json` schedules three crons: catalog weekly Mon 07:43, prices daily
   09:17, graded daily 10:37 (after prices, since it picks candidates from raw
   prices) — all UTC.
4. First deploy, run once against the production `DATABASE_URL` (from your
   machine is fine):
   ```bash
   npm run db:migrate
   npm run db:seed          # games + price-source registry (incl. pokeprice_graded)
   npx tsx --env-file=apps/web/.env.local apps/web/scripts/refresh-catalog.ts
   npx tsx --env-file=apps/web/.env.local apps/web/scripts/refresh-prices.ts
   npx tsx --env-file=apps/web/.env.local apps/web/scripts/refresh-graded.ts   # if POKEPRICE_TOKEN set
   ```

### Before a public launch — provider terms (NOT legal advice)

These are open items to settle before the site is public and monetised:

- **PriceCharting redistribution.** Its ToS restricts redistributing pricing
  data to third parties without express written consent. Displaying it on a
  public site likely needs a redistribution/commercial licence — resolve with
  PriceCharting directly, or drop the source. Since 2026-07-22 One Piece cards
  also have Scrydex (licensed) via `tcgplayer_market`, so PriceCharting is no
  longer OP's only card source — but it still solely covers SEALED prices and
  the eBay-sold blend leg.
- **PokemonPriceTracker commercial use** needs the Business tier ($99/mo); the
  free/$9.99 tiers are dev-only. Business also unlocks the PSA-population data
  the grading "Chance of 10" column is waiting on.
- **pokemontcg.io** requires an attribution credit + link — present in the
  footer and `/methodology`.
- Confirm the source-attribution strings in `src/lib/prices/sources.ts` and the
  fan-content disclaimers against each provider's current terms.

### Ops

`/admin` (paste `ADMIN_SECRET`): adapter status, price/snapshot counts, sets
needing data, `job_runs` history with errors, manual refresh buttons. Every
cron run lands in `job_runs` — failures included, by design.

## Data honesty model

Three sample-size states that are never conflated: a number (source disclosed
its n), `null` (real estimate, n undisclosed → capped at `low`), `0`
(placeholder — hidden from rankings). Two ROIs that are never conflated:
retail (vs MSRP) and market (vs what it actually costs today, hand-tracked
with provenance until a sealed source replaces it automatically). Known model
gaps (uniform-within-tier chase odds, the grading section's still-pending
PSA-10 grade odds, unmodelled reverse-holo/god-pack slots) are documented in
`/methodology`, in the code, and in `sourceNote`s — not hidden.
