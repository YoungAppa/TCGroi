/**
 * Backfill PSA population counts from Scrydex for every rankable set.
 *
 * These answer "what are my odds of a 10?" — the column the grading guide has
 * been showing as pending. The share of a card's graded population that came
 * back a 10 replaces a single site-wide gem-rate assumption that is wrong in
 * both directions: a 2021 Umbreon VMAX alt gems 69% of the time, a 1999
 * Unlimited Charizard 0.5%.
 *
 * Populations ride the same per-expansion paged request as prices, so this
 * costs a handful of credits per set. Idempotent: card_populations upserts on
 * (card, company).
 *
 * Usage: tsx --env-file=.env.local scripts/backfill-scrydex-populations.ts
 */
import { and, eq, sql } from "drizzle-orm";

import type { CatalogSet } from "@/lib/catalog/types";
import {
  cardPopulations,
  cards,
  games,
  getDb,
  latestPrices,
  pullRateTables,
  sets,
} from "@/lib/db";
import { scrydexPriceProvider } from "@/lib/prices/providers/scrydex-prices";
import type { PriceableCard } from "@/lib/prices/types";

async function main() {
  if (!scrydexPriceProvider.enabled()) {
    console.error("Scrydex credentials missing — set TCGPLAYER_MIRROR_API_KEY + SCRYDEX_TEAM_ID.");
    process.exit(1);
  }

  const db = getDb();
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
    .where(eq(sets.language, "EN"));

  const targets = setRows.filter((s) => s.gameSlug === "pokemon" || s.gameSlug === "one-piece");
  console.log(`Backfilling PSA populations for ${targets.length} sets…\n`);

  let total = 0;
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

      // Raw price tells the provider which PRINTING our row is — the same
      // disambiguation the graded prices need.
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

      const pops = await scrydexPriceProvider.fetchPopulations(catalogSet, priceable);

      const cardIdByExternal = new Map<string, string>();
      for (const c of cardRows) {
        for (const ext of Object.values(c.externalIds)) cardIdByExternal.set(ext, c.id);
      }

      const rows = pops
        .map((p) => {
          const cardId = cardIdByExternal.get(p.externalCardId);
          return cardId
            ? {
                cardId,
                company: p.company,
                total: p.total,
                gemCount: p.gemCount,
                grade9Count: p.grade9Count,
                capturedAt: new Date(),
              }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      for (let j = 0; j < rows.length; j += 500) {
        await db
          .insert(cardPopulations)
          .values(rows.slice(j, j + 500))
          .onConflictDoUpdate({
            target: [cardPopulations.cardId, cardPopulations.company],
            set: {
              total: sql`excluded.total`,
              gemCount: sql`excluded.gem_count`,
              grade9Count: sql`excluded.grade9_count`,
              capturedAt: sql`excluded.captured_at`,
              updatedAt: new Date(),
            },
          });
      }

      total += rows.length;
      if (rows.length > 0) setsWithData++;
      console.log(
        `[${i + 1}/${targets.length}] ${label.padEnd(24)} ${String(rows.length).padStart(5)} populations`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ set: label, error: msg });
      console.log(`[${i + 1}/${targets.length}] ${label.padEnd(24)} FAILED: ${msg.slice(0, 90)}`);
    }
  }

  console.log(
    `\nDone. ${total} card populations across ${setsWithData}/${targets.length} sets. ${failures.length} failures.`,
  );
  for (const f of failures) console.log(`  ${f.set}: ${f.error.slice(0, 120)}`);
  process.exit(0);
}

main();
