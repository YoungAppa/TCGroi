/**
 * Post-ingest sanity queries. Prints what actually landed in the DB —
 * run after refresh-catalog to confirm end-to-end integrity.
 *
 *   npx tsx --env-file=.env.local scripts/verify-db.ts
 */
import { desc, eq, sql } from "drizzle-orm";

import { cards, games, getDb, jobRuns, pullRateTables, sets } from "@/lib/db";

async function main() {
  const db = getDb();

  console.log("=== sets per game ===");
  const setRows = await db
    .select({
      game: games.slug,
      code: sets.code,
      name: sets.name,
      cardCount: sql<number>`(select count(*) from ${cards} where ${cards.setId} = ${sets.id})`,
    })
    .from(sets)
    .innerJoin(games, eq(sets.gameId, games.id))
    .orderBy(games.slug, sets.code);

  for (const r of setRows) {
    console.log(`  ${String(r.game).padEnd(10)} ${r.code.padEnd(8)} ${String(r.cardCount).padStart(4)} cards  ${r.name}`);
  }

  console.log("\n=== the OP09-118 test: one number, three printings ===");
  const roger = await db
    .select({ number: cards.number, treatment: cards.treatment, rarity: cards.rarity, name: cards.name })
    .from(cards)
    .where(eq(cards.number, "OP09-118"));
  for (const r of roger) {
    console.log(`  ${r.number}  ${r.treatment.padEnd(12)} ${r.rarity.padEnd(14)} ${r.name}`);
  }

  console.log("\n=== rarity distribution, One Piece (chase tiers) ===");
  const dist = await db
    .select({ rarity: cards.rarity, n: sql<number>`count(*)` })
    .from(cards)
    .innerJoin(sets, eq(cards.setId, sets.id))
    .innerJoin(games, eq(sets.gameId, games.id))
    .where(eq(games.slug, "one-piece"))
    .groupBy(cards.rarity)
    .orderBy(desc(sql`count(*)`));
  for (const r of dist) console.log(`  ${r.rarity.padEnd(16)} ${r.n}`);

  console.log("\n=== pull-rate tables ===");
  const tables = await db
    .select({
      code: sets.code,
      version: pullRateTables.version,
      confidence: pullRateTables.confidence,
      n: pullRateTables.sampleSizePacks,
      active: pullRateTables.isActive,
    })
    .from(pullRateTables)
    .innerJoin(sets, eq(pullRateTables.setId, sets.id));
  for (const t of tables) {
    console.log(`  ${t.code.padEnd(8)} v${t.version} ${String(t.confidence).padEnd(12)} n=${t.n} active=${t.active}`);
  }

  console.log("\n=== job runs ===");
  const runs = await db
    .select()
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt))
    .limit(5);
  for (const r of runs) {
    const dur = r.finishedAt ? `${((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(0)}s` : "-";
    console.log(`  ${r.job.padEnd(18)} ${r.status.padEnd(8)} ${dur.padStart(5)}  ${JSON.stringify(r.stats)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("verify failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
