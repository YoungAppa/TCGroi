/** Fallback pricing: unpriced mini tins take their set's GENERIC mini-tin
 *  price from PriceCharting (per-design rows often don't exist there). */
import { eq, and, isNull, sql } from "drizzle-orm";
import { games, getDb, latestPrices, priceSnapshots, sealedProducts, sets } from "@/lib/db";

async function main() {
  const db = getDb();
  const rows = await db.select({ id: sealedProducts.id, slug: sealedProducts.slug, name: sealedProducts.name, setName: sets.name, code: sets.code })
    .from(sealedProducts).innerJoin(sets, eq(sealedProducts.setId, sets.id))
    .where(and(eq(sealedProducts.type, "tin"), sql`not exists (select 1 from latest_prices lp where lp.sealed_product_id = ${sealedProducts.id})`));
  console.log("unpriced tins:", rows.length);
  const cache = new Map<string, number | null>();
  for (const r of rows) {
    if (!/mini tin/i.test(r.name)) { console.log("  skip (not mini):", r.slug); continue; }
    let median = cache.get(r.code);
    if (median === undefined) {
      const q = `pokemon ${r.setName} mini tin`;
      const res = await fetch(`https://www.pricecharting.com/api/products?t=${process.env.PRICECHARTING_TOKEN}&q=${encodeURIComponent(q)}`);
      const hits = (((await res.json()) as { products?: Record<string, any>[] }).products ?? []);
      const mine = hits.filter((p) =>
        /mini tin/i.test(p["product-name"] ?? "") &&
        !/display|\d+.pack|sam.s club|japanese|\bcase\b/i.test(p["product-name"] ?? "") &&
        /^pokemon/i.test(p["console-name"] ?? "") && Number(p["loose-price"] ?? 0) > 0);
      const prices = mine.map((p) => Number(p["loose-price"])).sort((a, b) => a - b);
      median = prices.length ? prices[Math.floor((prices.length - 1) / 2)]! : null;
      cache.set(r.code, median);
      console.log(`  [${r.code}] generic mini-tin price: ${median ? "$" + (median / 100).toFixed(2) : "none"} (${prices.length} rows)`);
    }
    if (median === null) continue;
    const snap = { sealedProductId: r.id, sourceId: "pricecharting_ebay", priceCents: median, kind: "sealed" as const, capturedAt: new Date() };
    await db.insert(priceSnapshots).values([snap]);
    await db.insert(latestPrices).values([snap]).onConflictDoUpdate({
      target: [latestPrices.sealedProductId, latestPrices.sourceId, latestPrices.kind],
      targetWhere: sql`${latestPrices.sealedProductId} IS NOT NULL`,
      set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
    });
    await new Promise((res) => setTimeout(res, 100));
  }
  console.log("done");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
