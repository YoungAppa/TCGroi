/**
 * Sealed products for the Japanese sets filled from PriceCharting (sets with
 * external_ids.pricecharting and no sealed product yet): the console's
 * "Booster Box" / "Booster Pack" rows become unranked, price-only products —
 * so a card page can say where the card comes from. No pack count is asserted
 * (none is stated by the source); these sets carry no pull table, so nothing
 * computes EV from them. Same convention as build-chinese-sealed.ts.
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { games, getDb, latestPrices, priceSnapshots, sealedProducts, sets } from "@/lib/db";

const CSV = process.argv[2]!;
const KINDS: Record<string, { type: "booster_box" | "booster_pack"; slug: string; name: string }> = {
  "booster box": { type: "booster_box", slug: "booster-box", name: "Booster Box" },
  "booster pack": { type: "booster_pack", slug: "booster-pack", name: "Booster Pack" },
};
function splitRow(line: string) {
  const first = line.indexOf(","); if (first < 0) return null;
  let rest = line.slice(first + 1);
  const take = () => { let v: string; if (rest.startsWith('"')) { const e = rest.indexOf('"', 1); v = rest.slice(1, e); rest = rest.slice(e + 2); } else { const e = rest.indexOf(","); v = rest.slice(0, e); rest = rest.slice(e + 1); } return v; };
  const c = take(); const p = take(); const dollars = Number(rest.split(",")[0]!.replace(/[$"]/g, ""));
  return { console: c, product: p, cents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null };
}
async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const byConsole = new Map<string, Map<string, number>>();
  for (const line of readFileSync(CSV, "utf8").split("\n").slice(1)) {
    const r = splitRow(line);
    if (!r || r.cents === null || !r.console.startsWith("Pokemon Japanese ")) continue;
    const kind = KINDS[r.product.trim().toLowerCase()];
    if (!kind) continue;
    const suffix = r.console.slice("Pokemon Japanese ".length).trim().toLowerCase();
    if (!byConsole.has(suffix)) byConsole.set(suffix, new Map());
    byConsole.get(suffix)!.set(kind.slug, r.cents);
  }
  const targets = await db.execute<{ id: string; code: string; name: string; pc: string }>(sql`
    select s.id, s.code, s.name, s.external_ids->>'pricecharting' as pc from sets s
    where s.game_id = ${pk!.id} and s.language = 'JP' and s.external_ids ? 'pricecharting'
      and not exists (select 1 from sealed_products p where p.set_id = s.id)
      and exists (select 1 from cards c where c.set_id = s.id)`);
  let made = 0, priced = 0;
  for (const t of [...targets]) {
    const prices = byConsole.get(t.pc.toLowerCase());
    if (!prices) continue;
    for (const [slug, cents] of prices) {
      const kind = Object.values(KINDS).find((k) => k.slug === slug)!;
      const [p] = await db.insert(sealedProducts).values({
        setId: t.id, name: kind.name, slug: kind.slug, type: kind.type, packsContained: 1, msrpCents: null,
        contentsNote: "Not ranked: no source publishes pull rates for this set, and the pack count per box is not stated by our price source — so this product carries a live price and no invented numbers.",
      }).onConflictDoNothing().returning({ id: sealedProducts.id });
      if (!p) continue;
      made++;
      const row = { sealedProductId: p.id, sourceId: "pricecharting_ebay", priceCents: cents, kind: "sealed" as const, capturedAt: new Date() };
      await db.insert(priceSnapshots).values(row);
      await db.insert(latestPrices).values(row).onConflictDoNothing();
      priced++;
    }
    console.log(`  + ${t.code} ${t.name}: ${[...prices.keys()].join(", ")}`);
  }
  console.log(`\nJP sealed from PC: ${made} products, ${priced} priced across ${[...targets].length} candidate sets`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
