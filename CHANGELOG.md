# Changelog

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
