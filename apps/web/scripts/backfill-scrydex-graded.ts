/**
 * Backfill PSA 10 / PSA 9 prices from Scrydex across every rankable set.
 *
 * The daily refresh-prices cron does this too (ScrydexGradedAdapter is
 * registered), but that job also re-fetches every raw and sealed source; this
 * script runs the graded pass alone so a fresh Growth subscription can be
 * filled in minutes without waiting a day or burning the other providers'
 * quotas. Idempotent: latest_prices upserts on (card, source, kind) and
 * price_snapshots is append-only history.
 *
 * Requires the Scrydex Growth plan — on Starter every entry comes back "raw"
 * and this writes nothing.
 *
 * Usage: tsx --env-file=.env.local scripts/backfill-scrydex-graded.ts
 */
import { and, eq, sql } from "drizzle-orm";

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
import { GRADED_SOURCE_ID, scrydexPriceProvider } from "@/lib/prices/providers/scrydex-prices";
import type { PriceableCard } from "@/lib/prices/types";

async function main() {
  if (!scrydexPriceProvider.enabled()) {
    console.error("Scrydex credentials missing — set TCGPLAYER_MIRROR_API_KEY + SCRYDEX_TEAM_ID.");
    process.exit(1);
  }

  const db = getDb();

  // Rankable English sets of the games Scrydex prices. Non-English sets are
  // rejected by the provider itself; filtering here just saves the round trip.
  const setRows = await db
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
    .innerJoin(pullRateTables, and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)))
    .where(and(eq(sets.language, "EN")));

  const targets = setRows.filter((s) => s.gameSlug === "pokemon" || s.gameSlug === "one-piece");
  console.log(`Backfilling graded prices for ${targets.length} sets…\n`);

  let totalRows = 0;
  let setsWithData = 0;
  const failures: { set: string; error: string }[] = [];

  for (const [i, setRow] of targets.entries()) {
    const label = `${setRow.gameSlug}/${setRow.code}`;
    try {
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

      if (cardRows.length === 0) continue;

      // Median raw price per card — tells the provider which PRINTING each of
      // our rows represents (see PriceableCard.rawCents).
      const rawRows = await db.execute<{ card_id: string; cents: number }>(sql`
        select lp.card_id,
               round(percentile_cont(0.5) within group (order by lp.price_cents))::int as cents
        from ${latestPrices} lp
        where lp.kind = 'raw'
          and lp.card_id in (${sql.join(
            cardRows.map((c) => sql`${c.id}::uuid`),
            sql`, `,
          )})
        group by lp.card_id
      `);
      const rawByCard = new Map<string, number>();
      for (const r of rawRows) rawByCard.set(r.card_id, Number(r.cents));

      const priceable: PriceableCard[] = cardRows.map((c) => ({
        cardId: c.id,
        name: c.name,
        number: c.number,
        rarity: c.rarity,
        treatment: c.treatment,
        externalIds: c.externalIds,
        rawCents: rawByCard.get(c.id) ?? null,
      }));

      const catalogSet: CatalogSet = {
        code: setRow.code,
        name: setRow.name,
        releaseDate: setRow.releaseDate,
        language: setRow.language,
        expectedCardCount: null,
        externalIds: setRow.externalIds,
      };

      const snapshots = await scrydexPriceProvider.fetchGradedPrices(catalogSet, priceable);

      // Resolve provider-side ids back to our card ids.
      const cardIdByExternal = new Map<string, string>();
      for (const c of cardRows) {
        for (const ext of Object.values(c.externalIds)) cardIdByExternal.set(ext, c.id);
      }

      const rows = snapshots
        .map((s) => {
          const cardId = s.externalCardId ? cardIdByExternal.get(s.externalCardId) : undefined;
          return cardId
            ? {
                cardId,
                sourceId: GRADED_SOURCE_ID,
                priceCents: s.priceCents,
                kind: s.kind,
                capturedAt: s.capturedAt,
              }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      for (let j = 0; j < rows.length; j += 500) {
        const chunk = rows.slice(j, j + 500);
        await db.insert(priceSnapshots).values(chunk);
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
      }

      totalRows += rows.length;
      if (rows.length > 0) setsWithData++;
      console.log(
        `[${i + 1}/${targets.length}] ${label.padEnd(24)} ${String(rows.length).padStart(5)} graded rows`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ set: label, error: msg });
      console.log(`[${i + 1}/${targets.length}] ${label.padEnd(24)} FAILED: ${msg.slice(0, 90)}`);
    }
  }

  console.log(
    `\nDone. ${totalRows} graded rows across ${setsWithData}/${targets.length} sets. ${failures.length} failures.`,
  );
  for (const f of failures) console.log(`  ${f.set}: ${f.error.slice(0, 120)}`);
  process.exit(0);
}

main();
