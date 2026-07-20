# PACKROI — session handoff (Windows → Mac)

You (Claude, on the Mac) are continuing an in-progress build. This file is your
onboarding: read it, then `README.md` for the runbook. The prior work was done
on Windows; this repo was transferred as a tarball including full git history
and `apps/web/.env.local`.

## First moves on this machine

```bash
cd packroi
node --version        # need Node 24.x  (nvm install 24 if missing)
npm install           # node_modules was NOT transferred
npm run verify        # typecheck + lint + tests + pull-rate validation — expect all green
npm run dev           # http://localhost:3000
```

`apps/web/.env.local` came with the archive (it's gitignored, so it would NOT
have survived a plain `git clone` — that's why we used a tarball). It holds the
live Neon `DATABASE_URL` + `ADMIN_SECRET`. The database is cloud-side (Neon),
reachable from here with no migration — the data is already there.

Path aliases and imports assume you run from the repo root via npm workspaces.

## What this is

Free public site: expected value + ROI of opening sealed Pokémon / One Piece
TCG products, from community pull rates × live market prices. Thesis: opening
sealed product is almost always −EV; the site shows exactly how much. Full spec
was in `~/Downloads/PLAN.md` on the Windows box (not transferred; README + this
file capture what matters).

## Layout (npm-workspaces monorepo)

```
apps/web       @packroi/web — Next 16, Drizzle→Neon, catalog+price adapters, cron jobs, data files
packages/ev    @packroi/ev  — pure EV/ROI engine (zero deps, zero I/O, 109 tests, strict coverage)
```

## Non-negotiable architecture rules (do not violate)

- No external API call in any page request path. Cron jobs write Postgres;
  pages read Postgres via ISR. The data layer has no `fetch`.
- Never scrape TCGplayer or any ToS-forbidden site — including consuming
  another service's scraped data (why One Piece uses optcgapi for catalog
  facts but NOT its prices).
- Pull rates are estimates and must look like it: confidence badge + sample
  size + source citation wherever numbers appear; source disagreements shown,
  not silently resolved.
- Unknown ≠ zero: an unpriced card is excluded from its tier average, never
  counted as $0.
- Money is integer cents end-to-end; expectations stay fractional and round
  once at display.

## State (as of handoff)

Done and committed (21 commits, working tree clean, all 171 tests passing):
- Phase 0 scaffold + Drizzle schema + Zod env + CI
- Phase 1 EV engine (packages/ev)
- Phase 2 catalog ingest — 13 sets, ~2,480 cards in Neon
- Phase 3 price adapters + cron (`/api/cron/*`, job_runs audit)
- Phase 4 pull-rate layer — **4 Pokémon sets at HIGH confidence**, all read
  directly from TCGplayer Authentication Center primary studies (sv8 n=8,000,
  sv1 n=1,728, sv3pt5 n=1,500, sv8pt5 n=1,200)
- Phase 5 UI — rankings, product, set, methodology, /admin; Retail-vs-Market
  two-ROI split; product/card images; guaranteed-promo sidecars
- Phase 7 (partial) — sitemap, robots, error pages, README runbook
- Monorepo conversion

Price sources: `tcgplayer_market` live via pokemontcg.io (free, keyless,
Pokémon only). One Piece = catalog only (its only keyless price source is
scraped). Sealed/market prices for Pokémon products are hand-tracked with
provenance in `apps/web/data/products/pokemon.json` until a sealed source lands.

## Blocked on the user (credentials)

- **Scrydex** (`TCGPLAYER_MIRROR_API_KEY` + `SCRYDEX_TEAM_ID`, $29/mo Starter):
  adds One Piece prices w/ clean provenance, graded, sealed. Adapter is written
  but UNVERIFIED — run `apps/web/scripts/probe-scrydex.ts` FIRST and reconcile
  `extractRawMarket()` with the real response before trusting any number.
- **PriceCharting** (`PRICECHARTING_TOKEN`, ~$6/mo Collector): eBay-sold +
  graded + sealed. Adapter written, psa9/psa10 field mapping UNVERIFIED — verify
  against one real response before launch.

## Suggested next steps (no new credentials needed)

1. More HIGH-confidence Pokémon sets via the same method: TCGplayer's studies
   for Stellar Crown, Twilight Masquerade, Temporal Forces exist (the Surging
   Sparks article references them). Their articles are client-rendered — read
   them with the in-app browser's `get_page_text`, NOT WebFetch (WebFetch gets
   an empty shell; WebFetch/pokebeach 403). Then: write the JSON, add products,
   `check:pullrates`, refresh-catalog + refresh-prices, verify.
2. One Piece pull-rate research (the genuinely hard data problem; encode the
   per-box SR guarantee via boxGuarantees `floor` mode — already tested).
3. Phase 6 graded mode (needs a graded price source above).
4. Phase 7 deploy to Vercel — **Root Directory must be `apps/web`**; env vars
   per README; crons in `apps/web/vercel.json`. There is no git remote yet;
   `git remote add` + push, or import the folder.

## Key commands

`npm run verify` · `npm run dev` · `npm run build` · `npm run check:pullrates`
Data jobs (from repo root):
`npx tsx --env-file=apps/web/.env.local apps/web/scripts/refresh-catalog.ts`
`npx tsx --env-file=apps/web/.env.local apps/web/scripts/refresh-prices.ts`
Probe/verify a new price provider before trusting it: the `apps/web/scripts/probe-*.ts` scripts.
