/**
 * Cross-source price-divergence audit: for every card priced by BOTH
 * tcgplayer_market and pricecharting_ebay, flag the ones whose prices disagree
 * by more than a threshold ratio. A large gap is usually one of two things:
 *
 *   1. A MATCHING BUG — the two sources are pricing different printings of the
 *      same number (a $2 base vs its $600 manga), i.e. a treatment/variant got
 *      mismatched on one side. These are real defects to fix.
 *   2. A genuine market disagreement (thin eBay volume, a stale side, or two
 *      different SKUs like plain vs sleeved). Real, and the source toggle is
 *      how the site already exposes it.
 *
 * The point is #1: this is how we catch a bad match before it ships a wrong EV.
 * Read-only; safe to run any time.
 *
 *   npx tsx --env-file=.env.local scripts/audit-price-divergence.ts
 *   npx tsx --env-file=.env.local scripts/audit-price-divergence.ts --game pokemon
 *   npx tsx --env-file=.env.local scripts/audit-price-divergence.ts --ratio 5 --floor 500
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const A = "tcgplayer_market";
const B = "pricecharting_ebay";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = getDb();
  const game = (arg("--game") ?? "one-piece") as "pokemon" | "one-piece" | "mtg";
  const ratioThreshold = Number(arg("--ratio") ?? "3"); // flag when max/min >= this
  const floorCents = Number(arg("--floor") ?? "100"); // ignore sub-$1 noise

  // Every raw price from the two sources, for this game's cards.
  const rows = await db
    .select({
      cardId: latestPrices.cardId,
      number: cards.number,
      name: cards.name,
      treatment: cards.treatment,
      rarity: cards.rarity,
      setCode: sets.code,
      source: latestPrices.sourceId,
      cents: latestPrices.priceCents,
    })
    .from(latestPrices)
    .innerJoin(cards, eq(latestPrices.cardId, cards.id))
    .innerJoin(sets, eq(cards.setId, sets.id))
    .innerJoin(games, eq(sets.gameId, games.id))
    .where(
      and(
        eq(games.slug, game),
        eq(latestPrices.kind, "raw"),
        inArray(latestPrices.sourceId, [A, B]),
      ),
    );

  // Fold to one row per card carrying both prices.
  const byCard = new Map<string, { meta: (typeof rows)[number]; a?: number; b?: number }>();
  for (const r of rows) {
    if (!r.cardId) continue; // nullable FK; card rows always have one
    const e = byCard.get(r.cardId) ?? { meta: r };
    if (r.source === A) e.a = r.cents;
    else e.b = r.cents;
    byCard.set(r.cardId, e);
  }

  const flagged: { r: number; a: number; b: number; m: (typeof rows)[number] }[] = [];
  let bothCount = 0;
  for (const { meta, a, b } of byCard.values()) {
    if (a === undefined || b === undefined) continue;
    bothCount++;
    if (a < floorCents && b < floorCents) continue;
    const ratio = Math.max(a, b) / Math.max(1, Math.min(a, b));
    if (ratio >= ratioThreshold) flagged.push({ r: ratio, a, b, m: meta });
  }
  flagged.sort((x, y) => y.r - x.r);

  console.log(
    `\nPrice-divergence audit — ${game}: ${bothCount} cards priced by both ` +
      `${A} + ${B}; ${flagged.length} disagree by ≥${ratioThreshold}× (floor $${(floorCents / 100).toFixed(2)}).\n`,
  );
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  for (const f of flagged.slice(0, 40)) {
    console.log(
      `  ${f.r.toFixed(1)}×  ${f.m.setCode} ${f.m.number} [${f.m.treatment}] ${f.m.rarity} ` +
        `— ${f.m.name}\n         ${A} ${fmt(f.a)}   |   ${B} ${fmt(f.b)}`,
    );
  }
  if (flagged.length > 40) console.log(`  … and ${flagged.length - 40} more.`);

  // Non-fatal: this is a QA lens, not a gate. Exit 0 always.
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("divergence audit failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
