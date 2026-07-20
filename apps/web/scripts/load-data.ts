/**
 * Load data-file changes (pull-rate tables + sealed products) into the DB for
 * sets that are ALREADY ingested, without re-hitting the catalog APIs.
 *
 * Use this after editing data/pullrates/** or data/products/** when the catalog
 * (sets + cards) is already up to date — it's the fast, network-light half of
 * refresh-catalog. To ingest a brand-new set's cards, run refresh-catalog.ts.
 *
 *   npx tsx --env-file=.env.local scripts/load-data.ts   (from apps/web)
 */
import { games, getDb } from "@/lib/db";
import { loadPullRateTables, loadSealedProducts } from "@/lib/jobs/refresh-catalog";

async function main() {
  const db = getDb();
  const gameRows = await db.select().from(games);
  const gameIdBySlug = new Map(gameRows.map((g) => [g.slug, g.id]));

  const tablesLoaded = await loadPullRateTables(gameIdBySlug);
  const productsLoaded = await loadSealedProducts(gameIdBySlug);

  console.log(`Loaded ${tablesLoaded} pull-rate table(s), ${productsLoaded} product(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("load-data FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
