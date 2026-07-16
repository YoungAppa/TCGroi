import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { CatalogSet } from "@/lib/catalog/types";
import {
  cards,
  games,
  getDb,
  latestPrices,
  priceSnapshots,
  pullRateTables,
  sets,
} from "@/lib/db";
import { enabledPriceAdapters } from "@/lib/prices/registry";
import type { PriceableCard, PriceSnapshotInput } from "@/lib/prices/types";

import { runJob } from "./run";

/**
 * refresh-prices: every enabled price adapter, over every set that can rank.
 *
 * Scope: sets with an active pull-rate table. A set without one cannot appear
 * in rankings, so pricing it burns quota for nothing; the moment its table
 * lands, the next run prices it.
 *
 * Quota priority (matters for per-card providers like PriceCharting; the
 * pokemontcg.io mirror is per-set bulk so it is unaffected): sealed products
 * first, then cards, bulk last. Encoded in the call order below.
 *
 * price_snapshots is append-only history; latest_prices is the projection
 * pages read. Both are written here and nowhere else.
 */
export async function refreshPrices() {
  return runJob("refresh-prices", async () => {
    const db = getDb();
    const adapters = enabledPriceAdapters();

    if (adapters.length === 0) {
      // Valid state, not an error: the site renders MSRP placeholders.
      return { adaptersRun: 0, snapshotsWritten: 0, note: "no price source configured" };
    }

    // Sets that can rank: active pull-rate table attached.
    const rankableSets = await db
      .select({
        id: sets.id,
        code: sets.code,
        name: sets.name,
        releaseDate: sets.releaseDate,
        language: sets.language,
        externalIds: sets.externalIds,
        gameSlug: games.slug,
      })
      .from(sets)
      .innerJoin(games, eq(sets.gameId, games.id))
      .innerJoin(
        pullRateTables,
        and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)),
      );

    let snapshotsWritten = 0;

    for (const setRow of rankableSets) {
      const catalogSet: CatalogSet = {
        code: setRow.code,
        name: setRow.name,
        releaseDate: setRow.releaseDate,
        language: setRow.language,
        expectedCardCount: null,
        externalIds: setRow.externalIds,
      };

      const cardRows = await db
        .select({
          id: cards.id,
          name: cards.name,
          number: cards.number,
          rarity: cards.rarity,
          externalIds: cards.externalIds,
        })
        .from(cards)
        .where(eq(cards.setId, setRow.id));

      const priceable: PriceableCard[] = cardRows.map((c) => ({
        cardId: c.id,
        name: c.name,
        number: c.number,
        rarity: c.rarity,
        externalIds: c.externalIds,
      }));

      // Map provider-side external ids back to our card ids. Built per set so
      // ids from one set can never mis-attach to another.
      const cardIdByExternal = new Map<string, string>();
      for (const c of cardRows) {
        for (const ext of Object.values(c.externalIds)) {
          cardIdByExternal.set(ext, c.id);
        }
      }

      for (const adapter of adapters) {
        // Priority order: sealed first (cheapest, highest value per call for
        // quota-bound providers), then cards. Graded runs with cards.
        const sealed = adapter.supports.sealed
          ? await adapter.fetchSealedPrices(catalogSet)
          : [];
        const raw = adapter.supports.cardsRaw
          ? await adapter.fetchCardPrices(catalogSet, priceable)
          : [];
        const graded =
          adapter.supports.cardsGraded && adapter.fetchGradedPrices
            ? await adapter.fetchGradedPrices(priceable)
            : [];

        snapshotsWritten += await writeSnapshots(
          [...sealed, ...raw, ...graded],
          cardIdByExternal,
        );
      }
    }

    return { adaptersRun: adapters.length, setsPriced: rankableSets.length, snapshotsWritten };
  });
}

async function writeSnapshots(
  inputs: PriceSnapshotInput[],
  cardIdByExternal: Map<string, string>,
): Promise<number> {
  if (inputs.length === 0) return 0;
  const db = getDb();
  let written = 0;

  // Chunked inserts: one round-trip per 500 rows rather than per row. Neon's
  // free tier is latency-bound, not row-bound.
  const CHUNK = 500;
  const resolved = inputs.flatMap((s) => {
    if (!s.externalCardId) return []; // sealed mapping lands with PriceCharting
    const cardId = cardIdByExternal.get(s.externalCardId);
    if (!cardId) return [];
    return [{ cardId, sourceId: s.sourceId, priceCents: s.priceCents, kind: s.kind, capturedAt: s.capturedAt }];
  });

  for (let i = 0; i < resolved.length; i += CHUNK) {
    const chunk = resolved.slice(i, i + CHUNK);

    await db.insert(priceSnapshots).values(chunk);

    // Projection upsert, batched: one statement per chunk, not per row. The
    // per-row version cost ~200s for 510 cards against Neon (latency-bound);
    // Vercel cron caps at 300s, so round-trips are the budget that matters.
    // `excluded` refers to the incoming row on conflict.
    await db
      .insert(latestPrices)
      .values(chunk)
      .onConflictDoUpdate({
        target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
        targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
        set: {
          priceCents: sql`excluded.price_cents`,
          capturedAt: sql`excluded.captured_at`,
          updatedAt: new Date(),
        },
      });
    written += chunk.length;
  }

  return written;
}

/**
 * Cards currently priced per set/source — used by verify-db and the admin
 * coverage view.
 */
export async function priceCoverage() {
  const db = getDb();
  return db
    .select({
      set: sets.code,
      source: latestPrices.sourceId,
      priced: sql<number>`count(distinct ${latestPrices.cardId})`,
      total: sql<number>`count(distinct ${cards.id})`,
    })
    .from(sets)
    .innerJoin(cards, eq(cards.setId, sets.id))
    .leftJoin(
      latestPrices,
      and(eq(latestPrices.cardId, cards.id), isNotNull(latestPrices.cardId)),
    )
    .groupBy(sets.code, latestPrices.sourceId);
}
