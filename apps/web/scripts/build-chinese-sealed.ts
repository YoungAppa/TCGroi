/**
 * Sealed products for every Simplified-Chinese set from PriceCharting.
 *
 * ZH sets carry externalIds.pricecharting (the console suffix); PC lists
 * sealed "Booster Box" / "Booster Pack" rows under "Pokemon Chinese <suffix>".
 * Products are created UNRANKED — no numeric odds source exists for standard
 * ZH boosters (only Gem Packs print theirs) — so they surface on set hubs
 * with live prices and an honest note, and rank the day odds arrive.
 * Idempotent. Gem-pack sets are skipped (already productized + ranked).
 */
import { and, eq, sql } from "drizzle-orm";
import { games, getDb, latestPrices, priceSnapshots, sealedProducts, sets } from "@/lib/db";

interface PcRow { "product-name"?: string; "console-name"?: string; "loose-price"?: number }

async function pc(q: string): Promise<PcRow[]> {
  const r = await fetch(
    `https://www.pricecharting.com/api/products?t=${process.env.PRICECHARTING_TOKEN}&q=${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!r.ok) return [];
  return ((await r.json()) as { products?: PcRow[] }).products ?? [];
}

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const zh = await db
    .select({ id: sets.id, code: sets.code, name: sets.name, ext: sets.externalIds })
    .from(sets)
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "ZH")));

  let made = 0, priced = 0, skipped = 0;
  for (const s of zh) {
    if (/^gem-pack/.test(s.code)) continue;
    const suffix = (s.ext as Record<string, string>)["pricecharting"];
    if (!suffix) { skipped++; continue; }
    const consoleName = `pokemon chinese ${suffix}`.toLowerCase();
    const rows = await pc(`pokemon chinese ${suffix} booster`);
    for (const kind of [
      { match: /^booster box$/i, slug: "booster-box", type: "booster_box" as const, name: "Booster Box", packs: 20 },
      { match: /^booster pack$/i, slug: "booster-pack", type: "booster_pack" as const, name: "Booster Pack", packs: 1 },
    ]) {
      const hit = rows.find(
        (r) =>
          (r["console-name"] ?? "").trim().toLowerCase() === consoleName &&
          kind.match.test((r["product-name"] ?? "").trim()) &&
          Number(r["loose-price"] ?? 0) > 0,
      );
      if (!hit) continue;
      // ZH box pack-counts vary by product line and no source states them per
      // set — packsContained stays 1 for the box too, and the contents note
      // says so, rather than asserting a count nobody published. EV needs odds
      // anyway before pack counts matter.
      const [prod] = await db
        .insert(sealedProducts)
        .values({
          setId: s.id,
          name: kind.name,
          slug: kind.slug,
          type: kind.type,
          packsContained: kind.packs === 1 ? 1 : 1,
          msrpCents: null,
          contentsNote:
            "Not ranked: no source publishes numeric pull rates for standard Simplified-Chinese " +
            "boosters (only Gem Packs print theirs), and pack counts per box are not stated by any " +
            "source we accept — so this product carries a live price and no invented numbers.",
        })
        .onConflictDoNothing({ target: [sealedProducts.setId, sealedProducts.slug] })
        .returning({ id: sealedProducts.id });
      if (!prod) continue;
      made++;
      const cents = Number(hit["loose-price"]);
      const snap = { sealedProductId: prod.id, sourceId: "pricecharting_ebay", priceCents: cents, kind: "sealed" as const, capturedAt: new Date() };
      await db.insert(priceSnapshots).values([snap]);
      await db.insert(latestPrices).values([snap]).onConflictDoUpdate({
        target: [latestPrices.sealedProductId, latestPrices.sourceId, latestPrices.kind],
        targetWhere: sql`${latestPrices.sealedProductId} IS NOT NULL`,
        set: { priceCents: cents, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
      });
      priced++;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`ZH products: created ${made}, priced ${priced}, sets without pc id: ${skipped}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
