/** False-positive gate: every product whose market ROI is >= 0, with its evidence. */
import { getRankings } from "@/lib/data";
import { computeProduct } from "@/lib/data/compute";
import { DEFAULT_FILTER_STATE } from "@packroi/ev/url-state";

async function main() {
  const { products, availableSources } = await getRankings();
  const ids = availableSources.map((s) => s.id);
  const pos: string[] = [];
  let ranked = 0;
  for (const p of products) {
    const c = computeProduct(p, DEFAULT_FILTER_STATE, ids);
    if (c.roiMarket === null) continue;
    ranked++;
    if (c.roiMarket >= 0)
      pos.push(`${(c.roiMarket * 100).toFixed(1).padStart(7)}%  ${p.gameSlug}/${p.setLanguage} ${p.setCode} ${p.productSlug} [${p.pullRates.confidence}] ${p.setName}`);
  }
  console.log(`Ranked products with a market ROI: ${ranked}`);
  console.log(`POSITIVE-ROI PRODUCTS: ${pos.length}`);
  for (const l of pos.sort().reverse()) console.log("  " + l);
  process.exit(0);
}
main();
