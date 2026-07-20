/**
 * Price-coverage audit: for every rankable set, how much of each pull-rate tier
 * actually has a price. A tier the EV engine iterates but that has no priced
 * cards silently vanishes from EV — this is how we catch that.
 *
 *   npx tsx --env-file=.env.local scripts/audit-coverage.ts            # all
 *   npx tsx --env-file=.env.local scripts/audit-coverage.ts --game one-piece
 *   npx tsx --env-file=.env.local scripts/audit-coverage.ts --min 90   # threshold %
 *   npx tsx --env-file=.env.local scripts/audit-coverage.ts --strict   # exit 1 on any gap
 *
 * Counting note: coverage is distinct CARDS priced, never rows. A LEFT JOIN to
 * latest_prices multiplies rows by the number of price sources (Pokémon carries
 * two), so `count(*)` reports ~200% and `count(distinct card)` is the honest
 * number. Only tiers named in the set's active pull-rate slots are judged —
 * a rarity with no slot never reaches EV, so its coverage is irrelevant.
 */
import { and, eq, sql } from "drizzle-orm";

import { cards, games, getDb, latestPrices, pullRateTables, sets } from "@/lib/db";

interface Slot {
  rarity: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = getDb();
  const gameFilter = arg("--game");
  const minPct = Number(arg("--min") ?? "80");
  const strict = process.argv.includes("--strict");

  const setRows = await db
    .select({
      id: sets.id,
      code: sets.code,
      name: sets.name,
      game: games.slug,
      slots: pullRateTables.slots,
    })
    .from(sets)
    .innerJoin(games, eq(sets.gameId, games.id))
    .innerJoin(
      pullRateTables,
      and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)),
    );

  const targets = setRows
    .filter((s) => !gameFilter || s.game === gameFilter)
    .sort((a, b) => (a.game + a.code).localeCompare(b.game + b.code));

  console.log(`Coverage audit — ${targets.length} rankable set(s), threshold ${minPct}% priced\n`);

  const gaps: string[] = [];
  for (const s of targets) {
    const slotRarities = new Set((((s.slots ?? []) as Slot[]) || []).map((x) => x.rarity));
    if (slotRarities.size === 0) continue;

    const rows = await db.execute<{ rarity: string; n: number; priced: number }>(sql`
      select c.rarity,
             count(distinct c.id)::int as n,
             count(distinct case when lp.card_id is not null then c.id end)::int as priced
      from ${cards} c
      left join ${latestPrices} lp on lp.card_id = c.id and lp.kind = 'raw'
      where c.set_id = ${s.id}
      group by c.rarity`);
    const byRarity = new Map([...rows].map((r) => [r.rarity, r]));

    const weak: string[] = [];
    for (const rar of slotRarities) {
      const r = byRarity.get(rar);
      if (!r || r.n === 0) {
        weak.push(`${rar}: NO CARDS`);
        continue;
      }
      const pct = Math.round((r.priced / r.n) * 100);
      if (pct < minPct) weak.push(`${rar} ${r.priced}/${r.n} (${pct}%)`);
    }

    const label = `${s.game.padEnd(9)} ${s.code.padEnd(10)} ${s.name}`;
    if (weak.length) {
      console.log(`⚠️  ${label}  →  ${weak.join(", ")}`);
      gaps.push(`${s.game}/${s.code} ${s.name}: ${weak.join(", ")}`);
    } else {
      console.log(`    ${label}  ok`);
    }
  }

  console.log(`\n${gaps.length} set(s) with a pull-rate tier under ${minPct}% priced.`);
  if (strict && gaps.length > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("audit-coverage FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
