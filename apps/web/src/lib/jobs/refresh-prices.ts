import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { CatalogSet } from "@/lib/catalog/types";
import {
  cards,
  games,
  getDb,
  latestPrices,
  priceSnapshots,
  pullRateTables,
  sealedProducts,
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

    // Plus any set containing a product's guaranteed promo card (svp): those
    // cards enter EV as fixed extras and need prices even though their set
    // never ranks.
    const promoSetRows = await db.execute<{
      id: string;
      code: string;
      name: string;
      release_date: string | null;
      language: "EN" | "JP" | "ZH";
      external_ids: Record<string, string>;
      slug: string;
    }>(sql`
      select distinct s.id, s.code, s.name, s.release_date, s.language,
                      s.external_ids, g.slug
      from ${sealedProducts} sp
      cross join lateral jsonb_array_elements_text(sp.guaranteed_card_ids) as gc(card_id)
      join ${cards} c on c.id = gc.card_id::uuid
      join ${sets} s on s.id = c.set_id
      join ${games} g on g.id = s.game_id
      where not exists (
        select 1 from ${pullRateTables} prt
        where prt.set_id = s.id and prt.is_active = true
      )
    `);

    const allSetsToPrice = [
      ...rankableSets,
      ...[...promoSetRows].map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        releaseDate: r.release_date,
        language: r.language,
        externalIds: r.external_ids,
        gameSlug: r.slug as "pokemon" | "one-piece" | "mtg",
      })),
    ];

    let snapshotsWritten = 0;
    // A single set's flaky external call (pokemontcg.io occasionally 404s a
    // valid set under load; Neon occasionally drops a write) must not abort the
    // whole run and strand every set after it. We isolate each (set, adapter)
    // fetch+write, record the failure, and press on — every write is
    // append-only + idempotent, so the next run retries only what failed.
    const failures: { set: string; adapter: string; error: string }[] = [];

    for (const setRow of allSetsToPrice) {
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
          treatment: cards.treatment,
          externalIds: cards.externalIds,
        })
        .from(cards)
        .where(eq(cards.setId, setRow.id));

      const priceable: PriceableCard[] = cardRows.map((c) => ({
        cardId: c.id,
        name: c.name,
        number: c.number,
        rarity: c.rarity,
        treatment: c.treatment,
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

      // Sealed products of this set, keyed by type. An adapter's sealed
      // snapshot carries only the product-type (all it can tell from a CSV), so
      // this is how it resolves to our product row.
      const sealedRows = await db
        .select({ id: sealedProducts.id, type: sealedProducts.type })
        .from(sealedProducts)
        .where(eq(sealedProducts.setId, setRow.id));
      const sealedIdByType = new Map(sealedRows.map((s) => [s.type as string, s.id]));

      for (const adapter of adapters) {
        try {
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
            sealedIdByType,
          );
        } catch (err) {
          failures.push({
            set: setRow.code,
            adapter: adapter.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return {
      adaptersRun: adapters.length,
      setsPriced: allSetsToPrice.length,
      snapshotsWritten,
      failures: failures.length,
      ...(failures.length > 0 ? { failed: failures } : {}),
    };
  });
}

async function writeSnapshots(
  inputs: PriceSnapshotInput[],
  cardIdByExternal: Map<string, string>,
  sealedIdByExternal: Map<string, string>,
): Promise<number> {
  if (inputs.length === 0) return 0;

  // Resolve each snapshot to one of our entities. Cards and sealed products go
  // to the same two tables but collide on different unique indexes, so they're
  // written in separate passes.
  const cardChunk: { cardId: string; sourceId: string; priceCents: number; kind: PriceSnapshotInput["kind"]; capturedAt: Date }[] = [];
  const sealedChunk: { sealedProductId: string; sourceId: string; priceCents: number; kind: PriceSnapshotInput["kind"]; capturedAt: Date }[] = [];
  for (const s of inputs) {
    if (s.externalCardId) {
      const cardId = cardIdByExternal.get(s.externalCardId);
      if (cardId) cardChunk.push({ cardId, sourceId: s.sourceId, priceCents: s.priceCents, kind: s.kind, capturedAt: s.capturedAt });
    } else if (s.externalProductId) {
      const sealedProductId = sealedIdByExternal.get(s.externalProductId);
      if (sealedProductId) sealedChunk.push({ sealedProductId, sourceId: s.sourceId, priceCents: s.priceCents, kind: s.kind, capturedAt: s.capturedAt });
    }
  }

  return (await writeCardChunks(cardChunk)) + (await writeSealedChunks(sealedChunk));
}

// Chunked inserts: one round-trip per 500 rows rather than per row. Neon's free
// tier is latency-bound, not row-bound. The projection upsert is batched too —
// the per-row version cost ~200s for 510 cards against Neon, and Vercel cron
// caps at 300s. `excluded` refers to the incoming row on conflict.
const CHUNK = 500;

async function writeCardChunks(
  rows: { cardId: string; sourceId: string; priceCents: number; kind: PriceSnapshotInput["kind"]; capturedAt: Date }[],
): Promise<number> {
  const db = getDb();
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.insert(priceSnapshots).values(chunk);
    await db
      .insert(latestPrices)
      .values(chunk)
      .onConflictDoUpdate({
        target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
        targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
        set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
      });
    written += chunk.length;
  }
  return written;
}

async function writeSealedChunks(
  rows: { sealedProductId: string; sourceId: string; priceCents: number; kind: PriceSnapshotInput["kind"]; capturedAt: Date }[],
): Promise<number> {
  const db = getDb();
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.insert(priceSnapshots).values(chunk);
    await db
      .insert(latestPrices)
      .values(chunk)
      .onConflictDoUpdate({
        target: [latestPrices.sealedProductId, latestPrices.sourceId, latestPrices.kind],
        targetWhere: sql`${latestPrices.sealedProductId} IS NOT NULL`,
        set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
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
