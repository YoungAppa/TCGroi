/**
 * Load the hand-maintained pull-rate tables + sealed products from
 * data/pullrates and data/products into the DB, without touching the catalog
 * adapters (no card re-ingest, no pruning, no image refresh). Idempotent — it
 * upserts every game's tables/products by set code, so re-running is safe.
 *
 * Use after editing a pull-rate or product JSON file (e.g. adding Magic).
 *
 *   npx tsx --env-file=.env.local scripts/load-pullrates-products.ts
 */
import { games, getDb } from "@/lib/db";
import { loadPullRateTables, loadSealedProducts } from "@/lib/jobs/refresh-catalog";

async function main() {
  const db = getDb();
  const gameRows = await db.select().from(games);
  const gameIdBySlug = new Map(gameRows.map((g) => [g.slug, g.id]));

  const tables = await loadPullRateTables(gameIdBySlug);
  const products = await loadSealedProducts(gameIdBySlug);
  console.log(`Loaded ${tables} pull-rate tables and ${products} sealed products.`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("load failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
