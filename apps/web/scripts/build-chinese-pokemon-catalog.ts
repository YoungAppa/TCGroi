/**
 * Build the Simplified Chinese Pokémon inventory from TCGdex — every 简体中文 set
 * and its cards, with images, under the pokemon game / language "ZH".
 *
 * Why Chinese is interesting beyond inventory: unlike EN/JP, Simplified Chinese
 * Pokémon packaging PRINTS official per-card pull rates (e.g. Gem Pack's 1.81%
 * triple-rare rate on the box). That makes an official-odds ROI possible later —
 * but that lives in the pull-rate/products data, not here. This is catalog-only,
 * price-less like the JP build. Requires migration 0004 (set_language += 'ZH').
 *
 *   npx tsx --env-file=.env.local scripts/build-chinese-pokemon-catalog.ts
 *   npx tsx --env-file=.env.local scripts/build-chinese-pokemon-catalog.ts --limit 10
 */
import { ingestTcgdexCatalog } from "./lib/tcgdex-catalog";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

ingestTcgdexCatalog({
  lang: "zh-cn",
  language: "ZH",
  label: "Simplified Chinese",
  limit: arg("--limit") ? Number(arg("--limit")) : undefined,
})
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("chinese pokemon build failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
