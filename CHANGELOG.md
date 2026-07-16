# Changelog

## Phase 4 (in progress) — Pull-rate layer

Zod schema, loader, and validation for `/data/pullrates/{game}/{setCode}.json`,
wired into CI. The schema's job is to make dishonest data unrepresentable:
rarity slugs are checked against the game's vocabulary, duplicate tiers and
over-1 probability sums are rejected, `boxGuarantees.mode` has no default, and
`confidence` is bounded by the evidence behind it.

`sampleSizePacks` is nullable, which the research forced. Three states that
must not be conflated: **a number** (the source published its sample), **null**
(a real community estimate whose sample was never disclosed), **0**
(placeholder — nobody measured). An undisclosed sample caps a table at `low`.

Two real, cited sets so far — no invented numbers:

| Set | Confidence | Sample | Source |
| --- | --- | --- | --- |
| `sv1` Scarlet & Violet Base | `high` | 1,728 packs | Card Shop Live published per-rarity hit **counts** |
| `sv8` Surging Sparks | `low` | undisclosed | ThePriceDex per-tier odds; a 500-pack opening disagrees ~20% |

Set-to-set variation is large and real (SIR ≈ 1 in 33 for SV Base vs ≈ 1 in 87
for Surging Sparks), so no set inherits another's rates.

## Phase 2 — Catalog adapters

Providers chosen by probing the live APIs, not by reading docs.

- **Pokémon: pokemontcg.io.** TCGdex was rejected — it exposes `rarity` only on
  its individual-card endpoint, so a 252-card set would cost 252 requests.
  pokemontcg.io returns full cards with rarity at 250/page, keyless.
- **One Piece: optcgapi, catalog only.** Every record carries `date_scraped`;
  its prices are scraped rather than licensed, and consuming them would launder
  a TCGplayer ToS violation through a third party. Card facts taken, prices
  ignored. One Piece EV waits on PriceCharting.

Two bugs found by verifying against live data:

1. **Card identity was wrong.** The unique index was `(set, number)`, but OP-09
   prints `OP09-118` three times — base SEC $36, Alternate Art $100, Manga
   $5,500 — and 25 numbers in that set have multiple printings. Identity is now
   `(set, number, treatment)`.
2. **Treatment mapping was lossy and ate the expensive cards.** Wanted Poster
   and Alternate Art both mapped to `alt_art`, so the dedupe silently dropped
   one printing of every card having both — Shanks $258 vs $27, Teach $256 vs
   $33, Buggy $181 vs $16. Wanted Poster is now its own treatment and tier;
   live ingest went 156 → 159 of 159 records.

Both adapters now fail loudly on an unmapped rarity or identity collision. A
dropped card crashes nothing — it just quietly lowers EV on a public page.

## Phase 1 — EV/ROI math engine

Pure, zero-I/O math library in `src/lib/ev`, built test-first. 97 tests.

- Blending across price sources (`median` default, plus `mean`/`min`/`max`).
- Bulk floor: cards under `BULK_THRESHOLD_CENTS` contribute a flat bulk value.
- Per-tier aggregation (`mean` default, `median` available) with coverage
  reporting.
- `EV(pack)`, `EV(product)`, ROI with the spec'd sealed-price fallback chain
  (pricecharting → tcgplayer_market → MSRP), always labelled with what it used.
- Variance extras: P(at least one) per rarity per product, expected hits, and a
  top-10 chase table with "1 in N packs" odds.
- Graded (PSA) mode and a `packsForProbability` solver for the
  "packs needed for 50%/90%" calculator.

Modelling decisions, each documented at its call site and headed for
`/methodology`:

- **Unknown is not zero.** An unpriced card is excluded from its tier average,
  never counted as $0, and the gap surfaces as a warning.
- **Box guarantees have an explicit `additive` / `floor` mode.** `floor` counts
  random pulls toward the guarantee and adds only the shortfall. Treating One
  Piece's per-box SR guarantee as additive would double-count it against
  community rates that already observed it.
- **Fractional cents are carried end to end** and rounded once at display.
- **Graded mode replaces raw** rather than taking the max, so it can show that
  grading destroys value on marginal cards.

Known gaps (deliberate, disclosed):

- The spec'd graded formula assigns no value to the ~20% of submissions grading
  8 or below, so graded EV is understated.
- Per-card odds assume uniform distribution within a rarity tier; no public
  dataset quantifies short prints.

## Phase 0 — Scaffold

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Drizzle + Zod + Vitest,
with CI running typecheck, lint, tests, and a build.

- Full domain schema: games/sets/cards/sealed_products, versioned
  `pull_rate_tables`, append-only `price_snapshots` with a `latest_prices`
  projection for fast reads, and `job_runs` for cron observability.
- Invariants live in the database, not in caller discipline: a price row targets
  exactly one entity (card XOR sealed product); `kind='sealed'` iff the row is a
  sealed product; set codes are unique per (game, language).
- Rarity vocabularies are per-game data, not code branches.
- Zod-validated env. **Verified:** the app builds and renders with only
  `DATABASE_URL` + `ADMIN_SECRET`, no price source configured and no live DB.
  CI asserts this on every run.
