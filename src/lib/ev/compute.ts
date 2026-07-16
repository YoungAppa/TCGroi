import { blendPrices } from "./blend";
import { groupByRarity, tierValue, type TierValue } from "./tiers";
import { effectiveCardValue } from "./value";
import type {
  CardPriceData,
  ChaseCard,
  Cents,
  EvOptions,
  EvResult,
  PullRateTable,
  SealedPriceOrigin,
  SealedProductInput,
  TierBreakdown,
} from "./types";

/**
 * Fallback order when no selected source prices the sealed product.
 * Spec'd: pricecharting (best sealed coverage) -> tcgplayer mirror -> MSRP.
 * The result always labels which was used; a fallback price is never passed
 * off as if it came from the user's chosen source.
 */
const SEALED_FALLBACK_ORDER = ["pricecharting_ebay", "tcgplayer_market"] as const;

export interface EvInput {
  product: SealedProductInput;
  table: PullRateTable;
  /** Every card in the set, priced. Cards of unlisted rarities are ignored. */
  cards: CardPriceData[];
}

/** P(at least one) across n independent Bernoulli(p) packs. */
function probAtLeastOnce(p: number, n: number): number {
  if (p <= 0 || n <= 0) return 0;
  if (p >= 1) return 1;
  return 1 - Math.pow(1 - p, n);
}

function resolveSealedPrice(
  product: SealedProductInput,
  opts: EvOptions,
): { priceCents: Cents | null; origin: SealedPriceOrigin } {
  const selected = blendPrices(product.sealed, opts.selectedSources, opts.blend);
  if (selected !== null) {
    const used = opts.selectedSources.filter((s) => product.sealed[s] !== undefined);
    return { priceCents: selected, origin: { kind: "selected", sourceIds: used } };
  }

  for (const sourceId of SEALED_FALLBACK_ORDER) {
    const p = product.sealed[sourceId];
    if (p !== undefined) {
      return { priceCents: p, origin: { kind: "fallback", sourceId } };
    }
  }

  if (product.msrpCents !== null) {
    return { priceCents: product.msrpCents, origin: { kind: "msrp" } };
  }

  return { priceCents: null, origin: { kind: "none" } };
}

/**
 * The whole EV/ROI computation for one sealed product. Pure: no I/O, no clock,
 * no randomness. Every input is passed in, so the same inputs always produce
 * the same numbers — which is what makes the client-side recompute on source
 * toggle safe to run against a prefetched payload.
 */
export function computeEv(input: EvInput, opts: EvOptions): EvResult {
  const { product, table, cards } = input;
  const warnings: string[] = [];
  const byRarity = groupByRarity(cards);

  // --- per-tier values (memoised: guarantees and chase reuse these) ---------
  const tierValues = new Map<string, TierValue>();
  const valueOf = (rarity: string): TierValue => {
    let v = tierValues.get(rarity);
    if (!v) {
      v = tierValue(rarity, byRarity, opts);
      tierValues.set(rarity, v);
    }
    return v;
  };

  const tiers: TierBreakdown[] = table.slots.map((slot) => {
    const tv = valueOf(slot.rarity);

    if (tv.totalCardCount === 0) {
      // The table names a tier the catalog has no cards for — almost always a
      // rarity-slug mismatch between the pull-rate file and the catalog
      // adapter. Silently contributing 0 would understate EV invisibly.
      warnings.push(
        `Pull-rate table lists rarity "${slot.rarity}" but the set has no cards of that rarity.`,
      );
    } else if (tv.pricedCardCount === 0) {
      warnings.push(
        `No priced cards for rarity "${slot.rarity}" — its EV contribution is counted as zero.`,
      );
    } else if (tv.pricedCardCount < tv.totalCardCount / 2) {
      warnings.push(
        `Only ${tv.pricedCardCount}/${tv.totalCardCount} cards priced for rarity "${slot.rarity}" — its value is an extrapolation.`,
      );
    }

    return {
      rarity: slot.rarity,
      perPackProbability: slot.perPackProbability,
      avgValueCents: tv.avgValueCents,
      evContributionCents: slot.perPackProbability * tv.avgValueCents,
      pricedCardCount: tv.pricedCardCount,
      totalCardCount: tv.totalCardCount,
    };
  });

  // --- EV(pack) ------------------------------------------------------------
  const guaranteedSlotValueCents = table.guaranteedSlots.reduce(
    (sum, g) => sum + g.countPerPack * valueOf(g.rarity).avgValueCents,
    0,
  );

  const evPackCents =
    tiers.reduce((sum, t) => sum + t.evContributionCents, 0) +
    guaranteedSlotValueCents;

  // --- EV(product) ---------------------------------------------------------
  const packs = product.packsContained;

  const cardById = new Map(cards.map((c) => [c.cardId, c]));
  const fixedExtrasCents = product.guaranteedCardIds.reduce((sum, id) => {
    const card = cardById.get(id);
    if (!card) {
      warnings.push(`Guaranteed card ${id} is not in the priced card list.`);
      return sum;
    }
    const v = effectiveCardValue(card, opts);
    if (v === null) {
      warnings.push(`Guaranteed card "${card.name}" has no price from the selected sources.`);
      return sum;
    }
    return sum + v.valueCents;
  }, 0);

  const probByRarity = new Map(table.slots.map((s) => [s.rarity, s.perPackProbability]));

  const boxGuaranteeCents = product.boxGuarantees.reduce((sum, g) => {
    const avg = valueOf(g.rarity).avgValueCents;
    if (g.mode === "additive") return sum + g.count * avg;

    // "floor": the random pulls already count toward the guarantee, so only
    // the shortfall is added. Treating this as additive would double-count the
    // guaranteed card on exactly the products that advertise one.
    const expectedRandom = (probByRarity.get(g.rarity) ?? 0) * packs;
    const shortfall = Math.max(0, g.count - expectedRandom);
    return sum + shortfall * avg;
  }, 0);

  const productExtrasValueCents = fixedExtrasCents + boxGuaranteeCents;
  const evProductCents = evPackCents * packs + productExtrasValueCents;

  // --- ROI -----------------------------------------------------------------
  const { priceCents: sealedPriceCents, origin: sealedPriceOrigin } =
    resolveSealedPrice(product, opts);

  if (sealedPriceOrigin.kind === "msrp") {
    warnings.push("No market price available — ROI is computed against MSRP.");
  } else if (sealedPriceOrigin.kind === "none") {
    warnings.push("No sealed price or MSRP available — ROI cannot be computed.");
  }

  const roi =
    sealedPriceCents !== null && sealedPriceCents > 0
      ? evProductCents / sealedPriceCents - 1
      : null;

  // --- variance extras -----------------------------------------------------
  const probAtLeastOne: Record<string, number> = {};
  for (const slot of table.slots) {
    probAtLeastOne[slot.rarity] = probAtLeastOnce(slot.perPackProbability, packs);
  }

  // A "hit" is any tier the pull-rate table bothers to enumerate. Tables list
  // the notable tiers and omit commons/uncommons, so this is data-driven
  // rather than a hardcoded per-game rarity list.
  const expectedHits = table.slots.reduce(
    (sum, s) => sum + s.perPackProbability * packs,
    0,
  );

  // --- chase table ---------------------------------------------------------
  const chase = buildChaseTable(cards, table, packs, opts, byRarity);

  if (table.confidence === "placeholder") {
    warnings.push(
      "Pull rates for this set are placeholders, not real community data. These numbers are not meaningful.",
    );
  }

  return {
    productId: product.productId,
    evPackCents,
    evProductCents,
    roi,
    sealedPriceCents,
    sealedPriceOrigin,
    tiers,
    guaranteedSlotValueCents,
    productExtrasValueCents,
    chase,
    expectedHits,
    probAtLeastOne,
    warnings,
  };
}

/**
 * Top cards by value, with the odds of hitting each.
 *
 * Per-card odds assume uniform distribution within a rarity tier:
 * P(this card, per pack) = P(tier, per pack) / (cards in tier). Real sets
 * violate this — short prints exist — but no public dataset quantifies it, so
 * uniform is the honest default and /methodology states it.
 */
function buildChaseTable(
  cards: CardPriceData[],
  table: PullRateTable,
  packs: number,
  opts: EvOptions,
  byRarity: Map<string, CardPriceData[]>,
  limit = 10,
): ChaseCard[] {
  const probByRarity = new Map(table.slots.map((s) => [s.rarity, s.perPackProbability]));

  const rows: ChaseCard[] = [];
  for (const card of cards) {
    const tierProb = probByRarity.get(card.rarity);
    // Only cards in a tier the table describes have knowable odds.
    if (tierProb === undefined) continue;

    const v = effectiveCardValue(card, opts);
    if (v === null || v.isBulk) continue;

    const tierSize = byRarity.get(card.rarity)?.length ?? 0;
    if (tierSize === 0) continue;

    const perPackProbability = tierProb / tierSize;
    rows.push({
      cardId: card.cardId,
      name: card.name,
      number: card.number,
      rarity: card.rarity,
      valueCents: v.valueCents,
      perPackProbability,
      oneInPacks: perPackProbability > 0 ? 1 / perPackProbability : Infinity,
      probPerProduct: probAtLeastOnce(perPackProbability, packs),
    });
  }

  return rows.sort((a, b) => b.valueCents - a.valueCents).slice(0, limit);
}

/**
 * Packs needed for a `target` probability of pulling a card with per-pack
 * probability `p`. Drives the "packs needed for 50% / 90% chance" calculator.
 * Returns Infinity when the card cannot be pulled.
 */
export function packsForProbability(p: number, target: number): number {
  if (p <= 0) return Infinity;
  if (p >= 1) return 1;
  if (target <= 0) return 0;
  if (target >= 1) return Infinity;
  // 1 - (1-p)^n >= target  =>  n >= log(1 - target) / log(1 - p)
  return Math.ceil(Math.log(1 - target) / Math.log(1 - p));
}
