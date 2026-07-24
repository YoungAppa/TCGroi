import {
  computeEv,
  DEFAULT_EV_OPTIONS,
  type EvOptions,
  type EvResult,
  type PullRateTable,
  type SealedProductInput,
} from "@packroi/ev";
import type { ChaseCard, TierBreakdown } from "@packroi/ev/types";
import { effectiveSources, type FilterState } from "@packroi/ev/url-state";

import type { ProductPayload } from "./types";

/**
 * ProductPayload + URL filter state -> EvResult.
 *
 * Pure, and shared verbatim by the rankings table and the product page, so a
 * product can never show one ROI in the list and another on its own page.
 * Runs client-side on every source toggle — that this is cheap is guaranteed
 * by the EV engine's purity, not by memoisation heroics.
 */
export interface ProductComputation {
  ev: EvResult;
  /** EV vs MSRP — "if you can find it at retail". Null when MSRP unknown. */
  roiRetail: number | null;
  /** EV vs today's market price — "what it actually costs". */
  roiMarket: number | null;
}

/** The full product computation: EV plus both ROIs the UI shows. */
export function computeProduct(
  payload: ProductPayload,
  filter: FilterState,
  availableSourceIds: string[],
): ProductComputation {
  const raw = computeForPayload(payload, filter, availableSourceIds);

  const roiOf = (price: number | null) =>
    price !== null && price > 0 ? raw.evProductCents / price - 1 : null;

  // The EV engine's internal ROI only sees live sealed sources + MSRP, so when a
  // product's only sealed price is the hand-tracked market figure (no live sealed
  // feed — every Magic product, some others), the engine warns that ROI fell back
  // to MSRP or can't be computed. But the UI shows a real market ROI from that
  // very figure, so those two warnings are inaccurate here — drop them.
  const ev =
    payload.market.priceCents !== null
      ? {
          ...raw,
          warnings: raw.warnings.filter(
            (w) =>
              !w.startsWith("No market price available") &&
              !w.startsWith("No sealed price or MSRP"),
          ),
        }
      : raw;

  return {
    ev,
    roiRetail: roiOf(payload.msrpCents),
    roiMarket: roiOf(payload.market.priceCents),
  };
}

export function computeForPayload(
  payload: ProductPayload,
  filter: FilterState,
  availableSourceIds: string[],
): EvResult {
  const opts: EvOptions = {
    ...DEFAULT_EV_OPTIONS,
    selectedSources: effectiveSources(filter, availableSourceIds),
    blend: filter.blend,
    graded: filter.graded,
  };

  // Mixed-pack collections (a UPC whose packs span several sets) can't ride one
  // set's pull table — blend each component set's per-pack EV by its pack count.
  if (payload.componentPacks && payload.componentPacks.length > 0) {
    return computeBlendedEv(payload, opts);
  }

  const table: PullRateTable = {
    setId: payload.setCode,
    version: payload.pullRates.version,
    sampleSizePacks: payload.pullRates.sampleSizePacks ?? 0,
    sourceUrl: payload.pullRates.sourceUrl,
    sourceNote: payload.pullRates.sourceNote,
    confidence: payload.pullRates.confidence,
    slots: payload.pullRates.slots,
    guaranteedSlots: payload.pullRates.guaranteedSlots,
  };

  const product: SealedProductInput = {
    productId: payload.productId,
    name: payload.productName,
    slug: payload.productSlug,
    type: payload.productType,
    packsContained: payload.packsContained,
    msrpCents: payload.msrpCents,
    sealed: payload.sealed,
    guaranteedCardIds: payload.guaranteedCardIds,
    boxGuarantees: payload.boxGuarantees,
  };

  return computeEv({ product, table, cards: payload.cards }, opts);
}

/**
 * EV of a fixed multi-set collection: the honest sum of its components. Each
 * component set contributes `count` packs valued on its OWN pull table, so a
 * product whose 18 packs are 3× set A + 2× set B + … is priced by what those
 * exact packs are worth — never by pretending they're all one set.
 *
 * The per-set numbers come from the real engine (one call per component, as a
 * single pack), so bulk floors, guaranteed slots, sources and blend all behave
 * identically to a normal product. Only the aggregation is bespoke:
 *  - EV(product) = Σ countᵢ · EV(packᵢ);  EV(pack) = EV(product) / totalPacks
 *  - P(≥1 rarity r) = 1 − Πᵢ (1 − pᵢ(r))^countᵢ  (independent across every pack)
 *  - tiers are the pack-count-weighted mixture, so Σ evContribution = EV(pack)
 * Guaranteed promos/exclusives are intentionally unmodelled, so EV understates.
 */
function computeBlendedEv(payload: ProductPayload, opts: EvOptions): EvResult {
  const components = payload.componentPacks ?? [];
  let evProductCents = 0;
  let totalPacks = 0;
  let expectedHits = 0;
  let guaranteedSlotValueCents = 0;
  // Π (1 − p)^count per rarity — the chance NO pack yields that rarity.
  const survive: Record<string, number> = {};
  const chase: ChaseCard[] = [];
  // Per-rarity pack-count-weighted sums, folded into a mixture "average pack".
  const tierAcc = new Map<
    string,
    { probWeighted: number; evWeighted: number; priced: number; total: number }
  >();

  for (const comp of components) {
    const table: PullRateTable = {
      setId: comp.setCode,
      version: comp.pullRates.version,
      sampleSizePacks: comp.pullRates.sampleSizePacks ?? 0,
      sourceUrl: comp.pullRates.sourceUrl,
      sourceNote: comp.pullRates.sourceNote,
      confidence: comp.pullRates.confidence,
      slots: comp.pullRates.slots,
      guaranteedSlots: comp.pullRates.guaranteedSlots,
    };
    // One pack of this set: EV(pack) and per-pack odds, unscaled by any box.
    const pack: SealedProductInput = {
      productId: `${payload.productId}:${comp.setCode}`,
      name: `${comp.setName} pack`,
      slug: comp.setCode,
      type: "booster_pack",
      packsContained: 1,
      msrpCents: null,
      sealed: {},
      guaranteedCardIds: [],
      boxGuarantees: [],
    };
    const ev = computeEv({ product: pack, table, cards: comp.cards }, opts);

    evProductCents += comp.count * ev.evPackCents;
    totalPacks += comp.count;
    expectedHits += comp.count * ev.expectedHits;
    guaranteedSlotValueCents += comp.count * ev.guaranteedSlotValueCents;

    for (const [rarity, pOnePack] of Object.entries(ev.probAtLeastOne)) {
      survive[rarity] = (survive[rarity] ?? 1) * Math.pow(1 - pOnePack, comp.count);
    }

    // Same per-pack odds, but "at least one across the product" now spans every
    // pack of this set in the box.
    for (const c of ev.chase) {
      chase.push({
        ...c,
        probPerProduct: 1 - Math.pow(1 - c.perPackProbability, comp.count),
      });
    }

    for (const t of ev.tiers) {
      const acc = tierAcc.get(t.rarity) ?? { probWeighted: 0, evWeighted: 0, priced: 0, total: 0 };
      acc.probWeighted += comp.count * t.perPackProbability;
      acc.evWeighted += comp.count * t.evContributionCents;
      acc.priced += t.pricedCardCount;
      acc.total += t.totalCardCount;
      tierAcc.set(t.rarity, acc);
    }
  }

  const probAtLeastOne: Record<string, number> = {};
  for (const [rarity, s] of Object.entries(survive)) probAtLeastOne[rarity] = 1 - s;

  // Average per-pack figures over the STATED pack count, so evPack × packs
  // reconciles to evProduct in the UI. When fewer packs are modelled than
  // stated, the unmodelled ones average in as zero (already disclosed).
  const packDivisor = payload.packsContained > 0 ? payload.packsContained : totalPacks;

  const tiers: TierBreakdown[] = [...tierAcc.entries()]
    .map(([rarity, a]) => {
      const perPackProbability = packDivisor > 0 ? a.probWeighted / packDivisor : 0;
      const evContributionCents = packDivisor > 0 ? a.evWeighted / packDivisor : 0;
      return {
        rarity,
        perPackProbability,
        avgValueCents: perPackProbability > 0 ? evContributionCents / perPackProbability : 0,
        evContributionCents,
        pricedCardCount: a.priced,
        totalCardCount: a.total,
      };
    })
    .sort((x, y) => y.evContributionCents - x.evContributionCents);

  chase.sort((a, b) => b.valueCents - a.valueCents);

  const mix = components.map((c) => `${c.count}× ${c.setName}`).join(", ");
  // The published breakdown may not attribute every stated pack to a set; model
  // only what's documented and disclose the shortfall (it understates EV).
  const gap = payload.packsContained - totalPacks;
  const gapNote =
    gap > 0
      ? ` Published breakdowns attribute ${totalPacks} of the ${payload.packsContained} packs; ` +
        `the remaining ${gap} ${gap === 1 ? "isn't" : "aren't"} specified, so ${gap === 1 ? "it's" : "they're"} omitted.`
      : "";
  const warnings = [
    `Blended EV: EV is the sum of each modelled pack's own-set EV (${mix}).${gapNote} ` +
      `Guaranteed promo/exclusive cards aren't modelled either, so EV understates the product.`,
  ];

  return {
    productId: payload.productId,
    evPackCents: packDivisor > 0 ? evProductCents / packDivisor : 0,
    evProductCents,
    roi: null,
    sealedPriceCents: null,
    sealedPriceOrigin: { kind: "none" },
    tiers,
    guaranteedSlotValueCents,
    productExtrasValueCents: 0,
    chase: chase.slice(0, 24),
    expectedHits,
    probAtLeastOne,
    warnings,
  };
}
