/**
 * Build the Japanese Pokémon inventory from TCGdex — every JP set and its cards,
 * with images, under the pokemon game / language "JP". Searchable and holdable
 * in the collection tracker; deliberately price-less (JP has no free price feed
 * yet, so the ROI side stays English). Cards carry their Japanese names, so
 * they're found by searching in Japanese. Idempotent.
 *
 *   npx tsx --env-file=.env.local scripts/build-japanese-pokemon-catalog.ts
 *   npx tsx --env-file=.env.local scripts/build-japanese-pokemon-catalog.ts --limit 10
 */
import { ingestTcgdexCatalog } from "./lib/tcgdex-catalog";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

ingestTcgdexCatalog({
  lang: "ja",
  language: "JP",
  label: "Japanese",
  limit: arg("--limit") ? Number(arg("--limit")) : undefined,
})
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("japanese pokemon build failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
