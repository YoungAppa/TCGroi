import { and, eq, inArray, or } from "drizzle-orm";

import {
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

  const sealedByProduct = new Map<string, PriceBySource>();
  for (const p of sealedPriceRows) {
    if (!p.sealedProductId) continue;
    sourcesWithData.add(p.sourceId);
    const existing = sealedByProduct.get(p.sealedProductId) ?? {};
    existing[p.sourceId] = p.priceCents;
    sealedByProduct.set(p.sealedProductId, existing);
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
  const cardById = new Map<string, (typeof cardRows)[number]>();
  for (const c of cardRows) {
    cardById.set(c.id, c);
    if (!nativeToSet(c.number, c.setId)) continue; // skip cross-set reprints
    const bucket = cardsBySet.get(c.setId);
    const entry = toCardPriceData(c);
    if (bucket) bucket.push(entry);
    else cardsBySet.set(c.setId, [entry]);
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
      msrpCents: p.msrpCents,
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
      cards: [...ownCards, ...extraPromos],
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
