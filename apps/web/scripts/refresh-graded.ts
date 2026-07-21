/**
 * refresh-graded: PSA 10 / PSA 9 sale prices for the Pokémon cards worth
 * grading, from PokemonPriceTracker. SEPARATE from the main price refresh
 * because it is credit-metered (free tier = 100/day, ~2 credits per card), so
 * it must be budgeted, cached, and prioritised — never a fetch-everything job.
 *
 *   npx tsx --env-file=.env.local scripts/refresh-graded.ts
 *   GRADED_MIN_RAW=2500 GRADED_CARDS=35 GRADED_CREDIT_CAP=80 npx tsx ... refresh-graded.ts
 *
 * Prioritises the highest-value cards not already priced within GRADED_REFRESH_DAYS,
 * so repeated runs walk down the value list and keep fresh cards fresh. Stops at
 * whichever comes first: GRADED_CARDS cards or GRADED_CREDIT_CAP credits.
 */
import { sql } from "drizzle-orm";

import { cards, games, getDb, latestPrices, priceSnapshots, sets } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { fetchGradedForCard, POKEPRICE_SOURCE_ID } from "@/lib/prices/pokeprice";

const MIN_RAW_CENTS = Number(process.env.GRADED_MIN_RAW ?? 2500); // $25 raw floor
const MAX_CARDS = Number(process.env.GRADED_CARDS ?? 35);
const CREDIT_CAP = Number(process.env.GRADED_CREDIT_CAP ?? 80);
const REFRESH_DAYS = Number(process.env.GRADED_REFRESH_DAYS ?? 7);
const PER_CALL_MS = 1100; // stay under the 60/min rate limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = getDb();
  const token = getEnv().POKEPRICE_TOKEN;
  if (!token) {
    console.error("POKEPRICE_TOKEN not set — nothing to do.");
    process.exit(1);
  }

  const cutoffIso = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString();

  // Pokémon cards whose blended raw price clears the floor and that have not
  // been graded-priced recently, highest value first.
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
      and raw.raw_cents >= ${MIN_RAW_CENTS}
      and (graded.graded_at is null or graded.graded_at < ${cutoffIso}::timestamptz)
    order by raw.raw_cents desc
    limit ${MAX_CARDS}
  `);

  const candidates = [...rows];
  console.log(
    `refresh-graded: ${candidates.length} candidate card(s) (raw >= $${(MIN_RAW_CENTS / 100).toFixed(0)}, not graded since ${cutoffIso.slice(0, 10)})`,
  );

  let creditsSpent = 0;
  let written = 0;
  let unmatched = 0;
  const capturedAt = new Date();

  for (const c of candidates) {
    if (creditsSpent + 2 > CREDIT_CAP) {
      console.log(`  credit cap ${CREDIT_CAP} reached — stopping.`);
      break;
    }

    const g = await fetchGradedForCard(token, {
      name: c.name,
      number: c.number,
      setName: c.setName,
    });
    creditsSpent += g.creditsUsed || 2;

    if (!g.matched) {
      unmatched++;
      console.log(`  ? ${c.setName} #${c.number} ${c.name} — no confident match, skipped`);
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
    const p10 = g.psa10Cents ? `$${(g.psa10Cents / 100).toFixed(0)}` : "—";
    console.log(
      `  ✓ ${c.setName} #${c.number} ${c.name}: raw $${(c.rawCents / 100).toFixed(0)} → PSA10 ${p10}`,
    );
    await sleep(PER_CALL_MS);
  }

  console.log(
    `\nDone. ${written} card(s) written, ${unmatched} unmatched, ~${creditsSpent} credits spent.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("refresh-graded FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
