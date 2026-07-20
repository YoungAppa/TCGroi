/**
 * End-to-end EV proof, with no database.
 *
 * Pulls the real Surging Sparks catalog and real TCGplayer market prices from
 * pokemontcg.io, loads the real hand-written pull-rate file, and runs the EV
 * engine over the lot. Every layer except persistence, exercised against live
 * data, producing the first real number the project has made.
 *
 *   npx tsx scripts/ev-demo.ts [setCode]
 *
 * Not in CI: it depends on the network and on third-party uptime.
 */
import { PokemonTcgIoAdapter } from "@/lib/catalog/providers/pokemontcgio";
import { rarityLabel } from "@/lib/catalog/rarities";
import {
  computeEv,
  DEFAULT_EV_OPTIONS,
  formatCents,
  formatOneIn,
  formatProbability,
  formatRoi,
  type CardPriceData,
  type EvOptions,
  type PullRateTable,
  type SealedProductInput,
} from "@packroi/ev";
import { pokemonTcgIoPriceProvider } from "@/lib/prices/providers/pokemontcgio-prices";
import type { PriceableCard } from "@/lib/prices/types";
import { computeDisagreements } from "@/lib/pullrates/disagreement";
import { loadAllPullRates } from "@/lib/pullrates/load";

const SET_CODE = process.argv[2] ?? "sv8";

/**
 * A real Surging Sparks booster box: 36 packs. The sealed price is passed in
 * by hand here because no configured source prices sealed product yet —
 * pokemontcg.io indexes singles only, and PriceCharting needs a token. It is
 * therefore an INPUT to this demo, not a measurement, and ROI inherits that.
 */
const BOOSTER_BOX: Omit<SealedProductInput, "sealed"> & { sealedDollars: number } = {
  productId: "sv8-booster-box",
  name: "Surging Sparks Booster Box",
  slug: "booster-box",
  type: "booster_box",
  packsContained: 36,
  msrpCents: 16344, // 36 packs x $4.54 MSRP
  guaranteedCardIds: [],
  boxGuarantees: [],
  sealedDollars: 129.99,
};

async function main() {
  const catalog = new PokemonTcgIoAdapter();

  const sets = await catalog.fetchSets();
  const set = sets.find((s) => s.code === SET_CODE);
  if (!set) throw new Error(`set ${SET_CODE} not found`);

  console.log(`\nSet: ${set.name} (${set.code}), released ${set.releaseDate}`);

  // --- catalog -------------------------------------------------------------
  const cards = await catalog.fetchCards(set);
  console.log(`Catalog: ${cards.length} cards`);

  // --- pull rates ----------------------------------------------------------
  const loaded = await loadAllPullRates();
  const entry = loaded.find((l) => l.file.setCode === SET_CODE);
  if (!entry) throw new Error(`no pull-rate file for ${SET_CODE}`);
  const prf = entry.file;

  console.log(
    `Pull rates: ${prf.confidence.toUpperCase()} confidence, ` +
      `${prf.sampleSizePacks === null ? "sample undisclosed" : `n=${prf.sampleSizePacks}`}`,
  );

  // --- prices --------------------------------------------------------------
  const priceable: PriceableCard[] = cards.map((c, i) => ({
    cardId: `${set.code}-${i}`,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    treatment: c.treatment,
    externalIds: c.externalIds,
  }));

  const snapshots = await pokemonTcgIoPriceProvider.fetchCardPrices(set, priceable);
  console.log(`Prices: ${snapshots.length}/${cards.length} cards priced (tcgplayer_market)\n`);

  const priceByExternalId = new Map(
    snapshots.map((s) => [s.externalCardId!, s.priceCents]),
  );

  const priced: CardPriceData[] = priceable.map((c) => {
    const cents = priceByExternalId.get(c.externalIds["pokemontcg_io"] ?? "");
    // Absent => the card is unpriced, which the engine treats as unknown and
    // excludes from its tier — deliberately not 0.
    const raw: Record<string, number> = {};
    if (cents !== undefined) raw["tcgplayer_market"] = cents;

    return {
      cardId: c.cardId,
      name: c.name,
      number: c.number,
      rarity: c.rarity,
      raw,
    };
  });

  // --- EV ------------------------------------------------------------------
  const table: PullRateTable = {
    setId: set.code,
    version: prf.version,
    sampleSizePacks: prf.sampleSizePacks ?? 0,
    sourceUrl: prf.sourceUrl,
    sourceNote: prf.sourceNote,
    confidence: prf.confidence,
    slots: prf.slots,
    guaranteedSlots: prf.guaranteedSlots,
  };

  const product: SealedProductInput = {
    ...BOOSTER_BOX,
    sealed: { tcgplayer_market: Math.round(BOOSTER_BOX.sealedDollars * 100) },
  };

  const opts: EvOptions = {
    ...DEFAULT_EV_OPTIONS,
    selectedSources: ["tcgplayer_market"],
  };

  const r = computeEv({ product, table, cards: priced }, opts);

  // --- report --------------------------------------------------------------
  console.log(`${product.name} — ${product.packsContained} packs @ ${formatCents(r.sealedPriceCents ?? 0)}\n`);

  console.log("EV by rarity tier (per pack):");
  console.log(`  ${"tier".padEnd(28)} ${"odds/pack".padStart(10)} ${"avg card".padStart(10)} ${"EV/pack".padStart(9)}  coverage`);
  for (const t of [...r.tiers].sort((a, b) => b.evContributionCents - a.evContributionCents)) {
    console.log(
      `  ${rarityLabel(t.rarity).padEnd(28)} ${formatProbability(t.perPackProbability).padStart(10)} ` +
        `${formatCents(t.avgValueCents).padStart(10)} ${formatCents(t.evContributionCents).padStart(9)}` +
        `  ${t.pricedCardCount}/${t.totalCardCount}`,
    );
  }

  console.log(`\n  EV per pack:     ${formatCents(r.evPackCents)}`);
  console.log(`  EV per box:      ${formatCents(r.evProductCents)}`);
  console.log(`  Box price:       ${formatCents(r.sealedPriceCents ?? 0)}  (${describeOrigin(r.sealedPriceOrigin)})`);
  console.log(`  ROI:             ${r.roi === null ? "n/a" : formatRoi(r.roi)}`);
  console.log(`  Expected hits:   ${r.expectedHits.toFixed(2)} per box`);

  console.log("\n  P(at least one) per box:");
  for (const [rarity, p] of Object.entries(r.probAtLeastOne).sort((a, b) => a[1] - b[1])) {
    console.log(`    ${rarityLabel(rarity).padEnd(28)} ${formatProbability(p).padStart(7)}`);
  }

  console.log("\nTop chase cards:");
  for (const c of r.chase.slice(0, 8)) {
    console.log(
      `  ${formatCents(c.valueCents).padStart(9)}  ${c.name} #${c.number}`.padEnd(52) +
        `${formatOneIn(c.oneInPacks).padStart(22)}   ${formatProbability(c.probPerProduct).padStart(6)}/box`,
    );
  }

  // --- honesty -------------------------------------------------------------
  const disagreements = computeDisagreements(prf);
  if (disagreements.length > 0) {
    console.log("\nSources disagree:");
    for (const d of disagreements) {
      console.log(`  ${rarityLabel(d.rarity)}: we use ${formatOneIn(1 / d.primaryProbability)}`);
      for (const a of d.alternates) {
        const pct = (a.relativeDifference * 100).toFixed(0);
        console.log(
          `    vs ${formatOneIn(1 / a.probability)} (${a.sampleSizePacks ?? "?"} packs) — ${pct}% apart`,
        );
      }
    }
  }

  if (r.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of r.warnings) console.log(`  ! ${w}`);
  }

  console.log(`\nPull rates: ${prf.sourceUrl}`);
  console.log("Community estimates, not official odds. Prices via pokemontcg.io (TCGplayer mirror).\n");
}

function describeOrigin(o: { kind: string; sourceIds?: string[]; sourceId?: string }): string {
  switch (o.kind) {
    case "selected":
      return `demo input, priced as ${o.sourceIds?.join("+")}`;
    case "fallback":
      return `fallback: ${o.sourceId}`;
    case "msrp":
      return "MSRP fallback";
    default:
      return "no price";
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("\nDemo failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
