import { desc, eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import {
  cards,
  games,
  getDb,
  jobRuns,
  latestPrices,
  priceSnapshots,
  pullRateTables,
  sets,
} from "@/lib/db";
import { cronAuthorized } from "@/lib/jobs/auth";
import { allPriceAdapters } from "@/lib/prices/registry";

export const dynamic = "force-dynamic";

/**
 * Everything the /admin page shows, in one authorized call. The page itself
 * is a public shell; all data flows through this route with the secret in an
 * Authorization header — never in a URL, which ends up in server logs.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getDb();

  const [runs, setRows, counts] = await Promise.all([
    db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(25),

    db
      .select({
        code: sets.code,
        name: sets.name,
        game: games.slug,
        cardCount: sql<number>`(select count(*) from ${cards} where ${cards.setId} = ${sets.id})`,
        confidence: pullRateTables.confidence,
        sampleSizePacks: pullRateTables.sampleSizePacks,
        version: pullRateTables.version,
      })
      .from(sets)
      .innerJoin(games, eq(sets.gameId, games.id))
      .leftJoin(
        pullRateTables,
        sql`${pullRateTables.setId} = ${sets.id} and ${pullRateTables.isActive} = true`,
      )
      .orderBy(games.slug, sets.code),

    db
      .select({
        snapshots: sql<number>`(select count(*) from ${priceSnapshots})`,
        latest: sql<number>`(select count(*) from ${latestPrices})`,
        cards: sql<number>`(select count(*) from ${cards})`,
      })
      .from(sql`(select 1) as one`),
  ]);

  const adapters = allPriceAdapters().map((a) => ({
    id: a.id,
    displayName: a.displayName,
    enabled: a.enabled(),
    supports: a.supports,
  }));

  // A set "needs data" when nothing real backs it: no active table, or a
  // placeholder one. These are exactly the sets hidden from rankings.
  const needsData = setRows.filter(
    (s) => s.confidence === null || s.confidence === "placeholder",
  );

  return NextResponse.json({
    adapters,
    counts: counts[0] ?? { snapshots: 0, latest: 0, cards: 0 },
    sets: setRows,
    needsData,
    jobRuns: runs.map((r) => ({
      id: r.id,
      job: r.job,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      seconds: r.finishedAt
        ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)
        : null,
      error: r.error,
      stats: r.stats,
    })),
  });
}
