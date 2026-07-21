import { sql } from "drizzle-orm";

import { cards, games, getDb, latestPrices, priceSnapshots, sets } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { fetchGradedForCard, POKEPRICE_SOURCE_ID } from "@/lib/prices/pokeprice";

import { runJob } from "./run";

/**
 * refresh-graded: PSA 10 / PSA 9 sale prices for the Pokémon cards worth
 * grading, from PokemonPriceTracker. SEPARATE from refresh-prices because it is
 * credit-metered (free tier = 100/day, ~2 credits per card): it fetches only
 * high-value cards, caches, and stops at a card or credit cap. Successive runs
 * walk down the value list and keep fresh cards fresh, so a modest daily cron
 * fills the whole chase set within a few days on the free tier.
 *
 * Absent POKEPRICE_TOKEN => no-op (the site works without graded prices).
 */
export interface RefreshGradedOptions {
  minRawCents?: number;
  maxCards?: number;
  creditCap?: number;
  refreshDays?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const PER_CALL_MS = 1100; // stay under the 60/min rate limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function refreshGraded(opts: RefreshGradedOptions = {}) {
  return runJob("refresh-graded", async () => {
    const token = getEnv().POKEPRICE_TOKEN;
    if (!token) {
      return { skipped: true as const, reason: "POKEPRICE_TOKEN not configured" };
    }

    const minRawCents = opts.minRawCents ?? 2500;
    const maxCards = opts.maxCards ?? 30;
    const creditCap = opts.creditCap ?? 70;
    const refreshDays = opts.refreshDays ?? 7;
    const fetchImpl = opts.fetchImpl ?? fetch;

    const db = getDb();
    const cutoffIso = new Date(Date.now() - refreshDays * 86_400_000).toISOString();

    // Pokémon cards whose blended raw price clears the floor and that have not
    // been graded-priced recently, highest value first. Promos never match.
    const rows = await db.execute<{
      id: string;
      name: string;
      number: string;
      setName: string;
      rawCents: number;
    }>(sql`
      with raw as (
        select lp.card_id,
               round(percentile_cont(0.5) within group (order by lp.price_cents))::int as raw_cents
        from ${latestPrices} lp
        where lp.kind = 'raw'
        group by lp.card_id
      ),
      graded as (
        select lp.card_id, max(lp.captured_at) as graded_at
        from ${latestPrices} lp
        where lp.source_id = ${POKEPRICE_SOURCE_ID} and lp.kind = 'psa10'
        group by lp.card_id
      )
      select c.id, c.name, c.number, s.name as "setName", raw.raw_cents::int as "rawCents"
      from ${cards} c
      join ${sets} s on s.id = c.set_id
      join ${games} g on g.id = s.game_id
      join raw on raw.card_id = c.id
      left join graded on graded.card_id = c.id
      where g.slug = 'pokemon'
        and s.code <> 'svp'
        and raw.raw_cents >= ${minRawCents}
        and (graded.graded_at is null or graded.graded_at < ${cutoffIso}::timestamptz)
      order by raw.raw_cents desc
      limit ${maxCards}
    `);

    let creditsSpent = 0;
    let written = 0;
    let skipped = 0;
    const capturedAt = new Date();

    for (const c of [...rows]) {
      if (creditsSpent + 2 > creditCap) break;

      const g = await fetchGradedForCard(token, { name: c.name, number: c.number, setName: c.setName }, fetchImpl);
      creditsSpent += g.creditsUsed || 2;

      // Skip a no-match or an implausible price (a PSA 10 below raw is bad data).
      const suspect =
        (g.psa10Cents !== null && g.psa10Cents < c.rawCents) ||
        (g.psa9Cents !== null && g.psa9Cents < Math.round(c.rawCents * 0.5));
      if (!g.matched || suspect) {
        skipped++;
        await sleep(PER_CALL_MS);
        continue;
      }

      const toWrite: { kind: "psa10" | "psa9"; cents: number }[] = [];
      if (g.psa10Cents) toWrite.push({ kind: "psa10", cents: g.psa10Cents });
      if (g.psa9Cents) toWrite.push({ kind: "psa9", cents: g.psa9Cents });

      for (const w of toWrite) {
        await db.insert(priceSnapshots).values({
          cardId: c.id,
          sourceId: POKEPRICE_SOURCE_ID,
          priceCents: w.cents,
          kind: w.kind,
          capturedAt,
        });
        await db
          .insert(latestPrices)
          .values({ cardId: c.id, sourceId: POKEPRICE_SOURCE_ID, priceCents: w.cents, kind: w.kind, capturedAt })
          .onConflictDoUpdate({
            target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
            targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
            set: { priceCents: w.cents, capturedAt, updatedAt: new Date() },
          });
      }
      if (toWrite.length) written++;
      await sleep(PER_CALL_MS);
    }

    return { cardsWritten: written, cardsSkipped: skipped, creditsSpent };
  });
}
