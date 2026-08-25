/** One-off: load the two new assorted UPCs, then attach art + live price. */
import { eq, and, sql } from "drizzle-orm";
import { games, getDb, latestPrices, priceSnapshots, sealedProducts, sets } from "@/lib/db";
import { loadSealedProducts } from "@/lib/jobs/refresh-catalog";

const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };

const TARGETS = [
  { setCode: "swsh11", slug: "charizard-ultra-premium-collection", scrydexImg: "https://images.scrydex.com/pokemon/swsh11-s3/large", pcQuery: "pokemon sword shield ultra premium collection charizard" },
  { setCode: "sv7", slug: "terapagos-ex-ultra-premium-collection", scrydexImg: "https://images.scrydex.com/pokemon/miscp-s194/large", pcQuery: "pokemon terapagos ultra premium collection" },
];

async function main() {
  const db = getDb();
  const gameRows = await db.select({ id: games.id, slug: games.slug }).from(games);
  const map = new Map(gameRows.filter(g => g.slug === "pokemon").map(g => [g.slug, g.id]));
  const n = await loadSealedProducts(map);
  console.log("loader upserted", n, "products");

  for (const t of TARGETS) {
    const [row] = await db.select({ id: sealedProducts.id, setId: sealedProducts.setId })
      .from(sealedProducts).innerJoin(sets, eq(sealedProducts.setId, sets.id))
      .where(and(eq(sets.code, t.setCode), eq(sets.language, "EN"), eq(sealedProducts.slug, t.slug)));
    if (!row) { console.log("MISSING after load:", t.slug); continue; }

    await db.update(sealedProducts).set({ imageUrl: t.scrydexImg, updatedAt: new Date() }).where(eq(sealedProducts.id, row.id));

    const r = await fetch(`https://www.pricecharting.com/api/products?t=${process.env.PRICECHARTING_TOKEN}&q=${encodeURIComponent(t.pcQuery)}`);
    const hits = (((await r.json()) as any).products ?? []) as any[];
    const mine = hits.filter(p =>
      /ultra.premium/i.test(p["product-name"] ?? "") &&
      !/\bcase\b|japanese/i.test(p["product-name"] ?? "") &&
      /^pokemon/i.test(p["console-name"] ?? "") &&
      Number(p["loose-price"] ?? 0) > 0);
    console.log(`${t.slug}: PC candidates ->`);
    for (const m of mine) console.log(`   $${(m["loose-price"]/100).toFixed(2)}  [${m["console-name"]}] ${m["product-name"]}`);
    if (mine.length === 0) { console.log("   no price found — leaving unpriced"); continue; }
    const prices = mine.map(m => Number(m["loose-price"])).sort((a,b)=>a-b);
    const cents = prices[Math.floor((prices.length-1)/2)]!;
    const snap = { sealedProductId: row.id, sourceId: "pricecharting_ebay", priceCents: cents, kind: "sealed" as const, capturedAt: new Date() };
    await db.insert(priceSnapshots).values([snap]);
    await db.insert(latestPrices).values([snap]).onConflictDoUpdate({
      target: [latestPrices.sealedProductId, latestPrices.sourceId, latestPrices.kind],
      targetWhere: sql`${latestPrices.sealedProductId} IS NOT NULL`,
      set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
    });
    console.log(`   priced $${(cents/100).toFixed(2)} (median of ${prices.length})`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
