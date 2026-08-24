import { and, eq, inArray, or } from "drizzle-orm";

import {
  cardPopulations,
  cards,
  games,
  getDb,
  latestPrices,
  pullRateTables,
  sealedProducts,
  sets,
} from "@/lib/db";
import type { CardPriceData, PriceBySource } from "@packroi/ev/types";
import { PRICE_SOURCES, type PriceSourceId } from "@/lib/prices/sources";
import type { AlternateEstimate } from "@/lib/pullrates/schema";

import type { ProductPayload, RankingsPayload } from "./types";

/**
 * The DB-backed data layer: Neon -> RankingsPayload.
 *
 * A handful of queries assembled in JS — never a query per product, never an
 * external API call. Pages are ISR'd, so this runs at build/revalidate only.
 */
/**
 * The most the market may exceed MSRP before MSRP stops being a real option.
 *
 * Set at 2x: normal retail scarcity and regional variation move a box maybe
 * 20-50% over list, but a box trading at double its MSRP is not a box anyone
 * is selling at MSRP.
 */
const MSRP_STALE_MARKET_RATIO = 2;

/**
 * How long a set's MSRP stays a real price after release.
 *
 * While a set is still being printed and distributed, its retail price is
 * something a buyer can actually pay — hard to find at MSRP is not the same as
 * impossible, and "what if I get it at retail" is a question worth answering
 * for anything still on shelves. Current Elite Trainer Boxes routinely sit at
 * 2.5-3x MSRP on the secondary market while remaining $49.99 in a shop, so a
 * pure ratio rule hides exactly the products where retail matters most.
 *
 * Once a set is out of print the MSRP becomes history: nobody is selling
 * Evolving Skies at $143.64, and quoting a retail ROI against it invents a
 * purchase. Pokémon sets leave print roughly two years after release, which is
 * where this sits.
 */
const MSRP_IN_PRINT_MONTHS = 24;

/**
 * MSRP, but only when it is still a price someone could actually pay.
 *
 * The printed retail price is real history and stays in the data files, yet
 * quoting a retail ROI against it implies a purchase that is not available:
 * Evolving Skies lists at $143.64 and trades at $2,417, which rendered as
 * "+108% at retail" on a box that loses ~88% at any price you can buy it for.
 * Pre-Sword & Shield sets already carry no MSRP for this reason; this applies
 * the same rule by evidence rather than by date, so a sought-after modern set
 * is treated like the vintage it now trades as. Returns null once the market
 * has run past the ratio, which makes the retail column read "—" exactly as an
 * unpriced product does.
 */
function purchasableMsrpCents(
  msrpCents: number | null,
  marketCents: number | null,
  releaseDate: string | Date | null,
): number | null {
  if (msrpCents === null || marketCents === null) return msrpCents;

  // Still in print: retail is a real price point even at a steep premium.
  if (releaseDate !== null) {
    const released = releaseDate instanceof Date ? releaseDate : new Date(releaseDate);
    if (!Number.isNaN(released.getTime())) {
      const monthsOld =
        (Date.now() - released.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      if (monthsOld <= MSRP_IN_PRINT_MONTHS) return msrpCents;
    }
  }

  return marketCents > msrpCents * MSRP_STALE_MARKET_RATIO ? null : msrpCents;
}

/**
 * How far a product's per-pack price may sit from its set's median before we
 * stop believing it.
 *
 * Loose single packs genuinely carry a lottery premium over the same pack
 * bought inside a box — measured across this catalog it runs about 2.5-3.5x,
 * and Japanese packs sit at the top of that. Six is comfortably clear of the
 * real premium while still catching the failure this exists for.
 */
export const SEALED_PER_PACK_OUTLIER_RATIO = 6;

/**
 * Drop sealed prices that cannot be true, judged against the set's own siblings.
 *
 * PriceCharting is matched by product name, and for single packs that match
 * sometimes lands on a sealed box, case or multi-pack lot instead. The result
 * is not subtly wrong, it is nonsense: Sword & Shield's Japanese base set had a
 * "booster pack" at $1,724.80 next to its own 30-pack box at $148.50, and
 * Battle Partners had a $222.93 pack beside a $79.00 box. Published, those read
 * as a site that does not check its own numbers.
 *
 * Two independent tests, both internal to the set. First, dominance: nothing may
 * cost more in total than a sibling holding several times the packs. Second, a
 * per-pack median check.
 *
 * The second test is internal consistency rather than an absolute band, because a real
 * price range spans three orders of magnitude across this catalog: reduce every
 * priced product in a set to a per-pack figure, take the median, and discard
 * anything more than SEALED_PER_PACK_OUTLIER_RATIO away from it in either
 * direction. A set needs at least three priced products to vote — with two, the
 * median is just the pair and there is no way to tell which one is lying, so
 * both are left alone rather than guessing.
 *
 * Discarded prices fall back to the hand-tracked market figure or to "—", the
 * same as a product nobody has priced. That is the safe direction: it removes a
 * claim rather than inventing one.
 */
export function dropImplausibleSealedPrices(
  products: { productId: string; packsContained: number }[],
  sealedByProduct: Map<string, PriceBySource>,
): void {
  const perPack: { productId: string; pp: number }[] = [];
  for (const p of products) {
    if (p.packsContained <= 0) continue;
    const values = Object.values(sealedByProduct.get(p.productId) ?? {});
    if (values.length === 0) continue;
    const median = [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]!;
    perPack.push({ productId: p.productId, pp: median / p.packsContained });
  }
  // Rule 1, and it needs no median: a product cannot cost more than a sibling
  // that contains several times as many of the same packs. Buying the bigger
  // one and splitting it would strictly dominate, so the cheaper-per-pack
  // product being *dearer in total* is an arbitrage that does not exist. This
  // is what catches a two-product set, where the median below has nothing to
  // arbitrate with -- Battle Partners listed a $222.93 single pack beside its
  // own $79.00 thirty-pack box. The 3x margin keeps it well away from real
  // cases where a scarce small product genuinely outruns a larger one.
  const priced = perPack.map((x) => ({
    ...x,
    packs: products.find((p) => p.productId === x.productId)!.packsContained,
    total: x.pp * products.find((p) => p.productId === x.productId)!.packsContained,
  }));
  for (const small of priced) {
    const dominated = priced.some(
      (big) => big.packs >= small.packs * 3 && big.total < small.total,
    );
    if (dominated) sealedByProduct.delete(small.productId);
  }

  // Rule 2 needs at least three priced products to vote: with two, the median
  // is just the pair and there is no way to tell which one is lying.
  if (perPack.length < 3) return;

  const sorted = [...perPack].map((x) => x.pp).sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
  if (median <= 0) return;

  for (const { productId, pp } of perPack) {
    const ratio = pp / median;
    if (ratio > SEALED_PER_PACK_OUTLIER_RATIO || ratio < 1 / SEALED_PER_PACK_OUTLIER_RATIO) {
      sealedByProduct.delete(productId);
    }
  }
}

export async function loadRankingsFromDb(): Promise<RankingsPayload> {
  const db = getDb();

  // --- products that can rank: active pull-rate table required --------------
  const productRows = await db
    .select({
      productId: sealedProducts.id,
      productName: sealedProducts.name,
      productSlug: sealedProducts.slug,
      productType: sealedProducts.type,
      packsContained: sealedProducts.packsContained,
      msrpCents: sealedProducts.msrpCents,
      manualMarketCents: sealedProducts.manualMarketCents,
      manualMarketAsOf: sealedProducts.manualMarketAsOf,
      manualMarketSource: sealedProducts.manualMarketSource,
      contentsNote: sealedProducts.contentsNote,
      guaranteedCardIds: sealedProducts.guaranteedCardIds,
      componentPacks: sealedProducts.componentPacks,
      productImageUrl: sealedProducts.imageUrl,
      setId: sets.id,
      setCode: sets.code,
      setName: sets.name,
      setLanguage: sets.language,
      releaseDate: sets.releaseDate,
      logoUrl: sets.logoUrl,
      gameSlug: games.slug,
      gameName: games.displayName,
      prVersion: pullRateTables.version,
      prSample: pullRateTables.sampleSizePacks,
      prSourceUrl: pullRateTables.sourceUrl,
      prSourceNote: pullRateTables.sourceNote,
      prConfidence: pullRateTables.confidence,
      prSlots: pullRateTables.slots,
      prGuaranteedSlots: pullRateTables.guaranteedSlots,
      prBoxGuarantees: pullRateTables.boxGuarantees,
      prAlternates: pullRateTables.alternateEstimates,
    })
    .from(sealedProducts)
    .innerJoin(sets, eq(sealedProducts.setId, sets.id))
    .innerJoin(games, eq(sets.gameId, games.id))
    .innerJoin(
      pullRateTables,
      and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)),
    );

  if (productRows.length === 0) {
    return { generatedAt: new Date().toISOString(), availableSources: [], products: [] };
  }

  const setIds = [...new Set(productRows.map((p) => p.setId))];
  // Guaranteed promo cards can live outside the ranked sets (svp) — they must
  // be fetched too, or the engine warns and drops their value.
  const promoCardIds = [...new Set(productRows.flatMap((p) => p.guaranteedCardIds))];

  // --- cards + their prices --------------------------------------------------
  const cardRows = await db
    .select({
      id: cards.id,
      setId: cards.setId,
      name: cards.name,
      number: cards.number,
      rarity: cards.rarity,
      imageUrl: cards.imageUrl,
      displayOnly: cards.displayOnly,
    })
    .from(cards)
    .where(
      promoCardIds.length > 0
        ? or(inArray(cards.setId, setIds), inArray(cards.id, promoCardIds))
        : inArray(cards.setId, setIds),
    );

  const cardIds = cardRows.map((c) => c.id);
  const cardPriceRows = cardIds.length
    ? await db
        .select({
          cardId: latestPrices.cardId,
          sourceId: latestPrices.sourceId,
          priceCents: latestPrices.priceCents,
          kind: latestPrices.kind,
        })
        .from(latestPrices)
        .where(inArray(latestPrices.cardId, cardIds))
    : [];

  const rawByCard = new Map<string, PriceBySource>();
  const psa9ByCard = new Map<string, PriceBySource>();
  const psa10ByCard = new Map<string, PriceBySource>();
  const sourcesWithData = new Set<string>();

  for (const p of cardPriceRows) {
    if (!p.cardId) continue;
    // Only RAW sources are toggleable in the rankings — they price the cards
    // that make up EV. A graded-only source (psa10/psa9) feeds the grading
    // section, not the raw blend, so it must not appear as a Sources pill
    // (selecting it alone would leave every card unpriced).
    if (p.kind === "raw") sourcesWithData.add(p.sourceId);
    const bucket =
      p.kind === "raw"
        ? rawByCard
        : p.kind === "psa9"
          ? psa9ByCard
          : p.kind === "psa10"
            ? psa10ByCard
            : null;
    if (!bucket) continue;
    const existing = bucket.get(p.cardId) ?? {};
    existing[p.sourceId] = p.priceCents;
    bucket.set(p.cardId, existing);
  }

  // --- sealed prices (live, from sources) -------------------------------------
  const productIds = productRows.map((p) => p.productId);
  const sealedPriceRows = await db
    .select({
      sealedProductId: latestPrices.sealedProductId,
      sourceId: latestPrices.sourceId,
      priceCents: latestPrices.priceCents,
    })
    .from(latestPrices)
    .where(inArray(latestPrices.sealedProductId, productIds));

  // --- PSA populations (per-card grading odds) ---------------------------------
  const popByCard = new Map<string, { total: number; gemCount: number; grade9Count: number }>();
  if (cardIds.length > 0) {
    const popRows = await db
      .select({
        cardId: cardPopulations.cardId,
        total: cardPopulations.total,
        gemCount: cardPopulations.gemCount,
        grade9Count: cardPopulations.grade9Count,
      })
      .from(cardPopulations)
      .where(
        and(eq(cardPopulations.company, "PSA"), inArray(cardPopulations.cardId, cardIds)),
      );
    for (const r of popRows) {
      popByCard.set(r.cardId, {
        total: r.total,
        gemCount: r.gemCount,
        grade9Count: r.grade9Count,
      });
    }
  }

  const sealedByProduct = new Map<string, PriceBySource>();
  for (const p of sealedPriceRows) {
    if (!p.sealedProductId) continue;
    sourcesWithData.add(p.sourceId);
    const existing = sealedByProduct.get(p.sealedProductId) ?? {};
    existing[p.sourceId] = p.priceCents;
    sealedByProduct.set(p.sealedProductId, existing);
  }

  // Sanity-check sealed prices against their own set before anything reads them,
  // so a mismatched source price cannot reach EV, the market column or the chart.
  {
    const bySet = new Map<string, { productId: string; packsContained: number }[]>();
    for (const p of productRows) {
      const list = bySet.get(p.setId) ?? [];
      list.push({ productId: p.productId, packsContained: p.packsContained });
      bySet.set(p.setId, list);
    }
    for (const list of bySet.values()) dropImplausibleSealedPrices(list, sealedByProduct);
  }

  // --- assemble ----------------------------------------------------------------
  const toCardPriceData = (c: (typeof cardRows)[number]): CardPriceData => {
    const entry: CardPriceData = {
      cardId: c.id,
      name: c.name,
      number: c.number,
      rarity: c.rarity,
      imageUrl: c.imageUrl,
      raw: rawByCard.get(c.id) ?? {},
    };
    const psa9 = psa9ByCard.get(c.id);
    const psa10 = psa10ByCard.get(c.id);
    if (psa9) entry.psa9 = psa9;
    if (psa10) entry.psa10 = psa10;
    const pop = popByCard.get(c.id);
    if (pop) entry.population = pop;
    return entry;
  };

  // A One Piece card belongs to a set's pull pool only when its collector-number
  // prefix matches the set (OP04-064 in OP-04). optcgapi lists cross-set
  // reprints — an OP01 or ST card under OP-04 — that are NOT pulled from this
  // set's packs; counting them inflates the tier averages and surfaces a foreign
  // card as the set's top chase. Pokémon numbers carry no such prefix, so they
  // always pass. cardById stays complete for guaranteed-promo resolution.
  const setCodeById = new Map(productRows.map((p) => [p.setId, p.setCode]));
  const OP_PREFIX = /^([A-Z]{1,3}\d{2})-/;
  const nativeToSet = (number: string, setId: string): boolean => {
    const m = number.match(OP_PREFIX);
    const code = setCodeById.get(setId);
    if (!m || !code) return true;
    return m[1]!.toUpperCase() === code.replace(/-/g, "").toUpperCase();
  };

  const cardsBySet = new Map<string, CardPriceData[]>();
  // Display-only cards (Magic treatments) are kept in a SEPARATE map so they
  // reach the gallery but never the EV card pool that computeEv sees.
  const displayBySet = new Map<string, CardPriceData[]>();
  const cardById = new Map<string, (typeof cardRows)[number]>();
  for (const c of cardRows) {
    cardById.set(c.id, c);
    if (!nativeToSet(c.number, c.setId)) continue; // skip cross-set reprints
    const target = c.displayOnly ? displayBySet : cardsBySet;
    const bucket = target.get(c.setId);
    const entry = toCardPriceData(c);
    if (bucket) bucket.push(entry);
    else target.set(c.setId, [entry]);
  }

  // Component-set lookup for blended products (mixed-pack collections). Each
  // ranked set's own active pull table + priced cards, keyed by set code and
  // deduped (a set shares one table across its products). Built from rows
  // already in memory, so a blend costs no extra query — and every component a
  // blended product references is guaranteed present, because load-data refuses
  // to ingest a blend whose component sets aren't ranked.
  type ComponentData = NonNullable<ProductPayload["componentPacks"]>[number];
  const componentBySetCode = new Map<string, Omit<ComponentData, "count">>();
  for (const r of productRows) {
    if (componentBySetCode.has(r.setCode)) continue;
    componentBySetCode.set(r.setCode, {
      setCode: r.setCode,
      setName: r.setName,
      pullRates: {
        version: r.prVersion,
        sampleSizePacks:
          r.prSample === 0 && r.prConfidence !== "placeholder" ? null : r.prSample,
        sourceUrl: r.prSourceUrl,
        sourceNote: r.prSourceNote,
        confidence: r.prConfidence,
        slots: r.prSlots,
        guaranteedSlots: r.prGuaranteedSlots as ComponentData["pullRates"]["guaranteedSlots"],
      },
      cards: cardsBySet.get(r.setId) ?? [],
    });
  }

  const products: ProductPayload[] = productRows.map((p) => {
    // Live sealed source prices win; the hand-tracked figure is the labelled
    // fallback. Median across sources once more than one covers sealed.
    const sealed = sealedByProduct.get(p.productId) ?? {};
    const liveValues = Object.values(sealed);
    const liveMarket =
      liveValues.length > 0
        ? [...liveValues].sort((a, b) => a - b)[Math.floor((liveValues.length - 1) / 2)]!
        : null;

    const market: ProductPayload["market"] =
      liveMarket !== null
        ? { priceCents: liveMarket, isManual: false, asOf: null, source: "live sources" }
        : {
            priceCents: p.manualMarketCents,
            isManual: p.manualMarketCents !== null,
            asOf: p.manualMarketAsOf,
            source: p.manualMarketSource,
          };

    // The set's cards, plus this product's guaranteed promos from other sets
    // (their "promo" rarity is in no pull-rate slot, so they cannot pollute
    // tier averages or the chase table — they price only the fixed extras).
    const ownCards = cardsBySet.get(p.setId) ?? [];
    const extraPromos = p.guaranteedCardIds
      .map((id) => cardById.get(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined && c.setId !== p.setId)
      .map(toCardPriceData);

    const promos = p.guaranteedCardIds.flatMap((id) => {
      const c = cardById.get(id);
      return c
        ? [{ cardId: c.id, name: c.name, number: c.number, imageUrl: c.imageUrl }]
        : [];
    });

    // Resolve this product's fixed pack breakdown (if any) to embedded
    // component tables + cards, so the blend is self-contained in the payload.
    const componentPacks = p.componentPacks.flatMap((cp) => {
      const src = componentBySetCode.get(cp.setCode);
      return src ? [{ ...src, count: cp.count }] : [];
    });

    return {
      gameSlug: p.gameSlug as ProductPayload["gameSlug"],
      gameName: p.gameName,
      setCode: p.setCode,
      setName: p.setName,
      setLanguage: p.setLanguage,
      releaseDate: p.releaseDate,
      productId: p.productId,
      productName: p.productName,
      productSlug: p.productSlug,
      productType: p.productType,
      packsContained: p.packsContained,
      // Prefer the actual box/pack photo; fall back to the set logo.
      imageUrl: p.productImageUrl ?? p.logoUrl,
      msrpCents: purchasableMsrpCents(p.msrpCents, market.priceCents, p.releaseDate),
      market,
      sealed,
      guaranteedCardIds: p.guaranteedCardIds,
      promos,
      contentsNote: p.contentsNote,
      boxGuarantees: p.prBoxGuarantees as ProductPayload["boxGuarantees"],
      pullRates: {
        version: p.prVersion,
        sampleSizePacks:
          p.prSample === 0 && p.prConfidence !== "placeholder" ? null : p.prSample,
        sourceUrl: p.prSourceUrl,
        sourceNote: p.prSourceNote,
        confidence: p.prConfidence,
        slots: p.prSlots,
        guaranteedSlots: p.prGuaranteedSlots as ProductPayload["pullRates"]["guaranteedSlots"],
        alternateEstimates: p.prAlternates as unknown as AlternateEstimate[],
      },
      ...(componentPacks.length > 0 ? { componentPacks } : {}),
      cards: [...ownCards, ...extraPromos],
      ...((displayBySet.get(p.setId)?.length ?? 0) > 0
        ? { displayCards: displayBySet.get(p.setId) }
        : {}),
    };
  });

  const availableSources = [...sourcesWithData].map((id) => ({
    id,
    displayName: PRICE_SOURCES[id as PriceSourceId]?.displayName ?? id,
  }));

  return {
    generatedAt: new Date().toISOString(),
    availableSources,
    products,
  };
}
