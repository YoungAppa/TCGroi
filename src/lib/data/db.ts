import { and, eq, inArray } from "drizzle-orm";

import {
  cards,
  games,
  getDb,
  latestPrices,
  pullRateTables,
  sealedProducts,
  sets,
} from "@/lib/db";
import type { CardPriceData, PriceBySource } from "@/lib/ev/types";
import { PRICE_SOURCES, type PriceSourceId } from "@/lib/prices/sources";
import type { AlternateEstimate } from "@/lib/pullrates/schema";

import type { ProductPayload, RankingsPayload } from "./types";

/**
 * The DB-backed data layer: Neon -> RankingsPayload, the exact shape the
 * fixture served, so no page changed when this landed.
 *
 * Four queries total (products, cards, card prices, sealed prices), assembled
 * in JS — not a query per product. Pages are ISR'd, so this runs at build and
 * revalidation, never per request, and never calls an external API.
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
      guaranteedCardIds: sealedProducts.guaranteedCardIds,
      setId: sets.id,
      setCode: sets.code,
      setName: sets.name,
      releaseDate: sets.releaseDate,
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

  // --- cards + their prices --------------------------------------------------
  const cardRows = await db
    .select({
      id: cards.id,
      setId: cards.setId,
      name: cards.name,
      number: cards.number,
      rarity: cards.rarity,
    })
    .from(cards)
    .where(inArray(cards.setId, setIds));

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

  // kind -> per-card PriceBySource
  const rawByCard = new Map<string, PriceBySource>();
  const psa9ByCard = new Map<string, PriceBySource>();
  const psa10ByCard = new Map<string, PriceBySource>();
  const sourcesWithData = new Set<string>();

  for (const p of cardPriceRows) {
    if (!p.cardId) continue;
    sourcesWithData.add(p.sourceId);
    const bucket =
      p.kind === "raw" ? rawByCard : p.kind === "psa9" ? psa9ByCard : p.kind === "psa10" ? psa10ByCard : null;
    if (!bucket) continue;
    const existing = bucket.get(p.cardId) ?? {};
    existing[p.sourceId] = p.priceCents;
    bucket.set(p.cardId, existing);
  }

  // --- sealed prices ----------------------------------------------------------
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
  const cardsBySet = new Map<string, CardPriceData[]>();
  for (const c of cardRows) {
    const entry: CardPriceData = {
      cardId: c.id,
      name: c.name,
      number: c.number,
      rarity: c.rarity,
      raw: rawByCard.get(c.id) ?? {},
    };
    const psa9 = psa9ByCard.get(c.id);
    const psa10 = psa10ByCard.get(c.id);
    if (psa9) entry.psa9 = psa9;
    if (psa10) entry.psa10 = psa10;

    const bucket = cardsBySet.get(c.setId);
    if (bucket) bucket.push(entry);
    else cardsBySet.set(c.setId, [entry]);
  }

  const products: ProductPayload[] = productRows.map((p) => ({
    gameSlug: p.gameSlug as ProductPayload["gameSlug"],
    gameName: p.gameName,
    setCode: p.setCode,
    setName: p.setName,
    releaseDate: p.releaseDate,
    productId: p.productId,
    productName: p.productName,
    productSlug: p.productSlug,
    productType: p.productType,
    packsContained: p.packsContained,
    msrpCents: p.msrpCents,
    sealed: sealedByProduct.get(p.productId) ?? {},
    // No live sealed price => ROI falls back (labelled) and the UI marks it.
    sealedIsPlaceholder: !sealedByProduct.has(p.productId),
    guaranteedCardIds: p.guaranteedCardIds,
    boxGuarantees: p.prBoxGuarantees as ProductPayload["boxGuarantees"],
    pullRates: {
      version: p.prVersion,
      // DB stores 0 for "undisclosed or placeholder"; the payload restores
      // the distinction the UI cares about (null = undisclosed).
      sampleSizePacks:
        p.prSample === 0 && p.prConfidence !== "placeholder" ? null : p.prSample,
      sourceUrl: p.prSourceUrl,
      sourceNote: p.prSourceNote,
      confidence: p.prConfidence,
      slots: p.prSlots,
      guaranteedSlots: p.prGuaranteedSlots as ProductPayload["pullRates"]["guaranteedSlots"],
      alternateEstimates: p.prAlternates as unknown as AlternateEstimate[],
    },
    cards: cardsBySet.get(p.setId) ?? [],
  }));

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
