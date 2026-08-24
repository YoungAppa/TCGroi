/**
 * The false-positive gate.
 *
 * This site's one unforgivable failure is telling someone a sealed product is
 * worth opening when it isn't — a positive ROI is the only number here that
 * moves money, so a wrong one does real harm while a wrong negative just costs
 * us a reader. Every data change therefore ends by running this and comparing
 * the list to the last known-good one: a NEW positive is guilty until proven
 * innocent, and the usual cause is a pull-rate slot that got a probability it
 * did not earn, or a price matched to the wrong printing.
 *
 * It prints every product whose MARKET ROI is >= 0 with the confidence tier
 * behind it. Market, not retail: retail ROI answers "what if I found it at
 * MSRP", which is not a price most readers can actually pay.
 *
 * As of 2026-08-25 the expected output is exactly six, all Magic, all LOW —
 * Magic's odds are modelled from set structure and are under separate review.
 * Any Pokemon or One Piece product appearing here is a bug until investigated.
 *
 *   npx tsx --env-file=.env.local scripts/check-false-positives.ts
 */
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
