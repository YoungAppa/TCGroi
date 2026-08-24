/**
 * Sealed products for Japanese Pokémon sets.
 *
 * This is what was actually blocking Japanese ROI. The catalog has 335 sets and
 * 12,351 priced cards, but only 5 sets carried a booster box or pack to price
 * an opening AGAINST — without a sealed product there is nothing to compute a
 * return on, so the sets could not rank no matter how good the card data got.
 *
 * Neither source alone is enough:
 *   - Scrydex knows the PRODUCTS (a Japanese expansion's box/pack, correctly
 *     typed, with box art) but returns no price for any of them.
 *   - PriceCharting knows the PRICES, under English console names
 *     ("Pokemon Japanese Terastal Festival"), which is also how Scrydex names
 *     the products even when the set name itself is Japanese.
 *
 * So the Scrydex product name is the bridge: "Terastal Festival ex Booster Box"
 * gives both the product type and the English set name to look up.
 *
 * Prices are Japanese-market and quoted in USD by PriceCharting, matching every
 * other price on the site. Products are created even when no price is found —
 * a box with box art and no price is still worth showing, and a price can
 * arrive later without re-ingesting.
 *
 * Usage: tsx --env-file=.env.local scripts/build-japanese-pokemon-sealed.ts [setCodePrefix]
 */
import { and, eq, sql } from "drizzle-orm";

import {
  games,
  getDb,
  latestPrices,
  priceSnapshots,
  sealedProducts,
  sets,
} from "@/lib/db";

const BASE = "https://api.scrydex.com";

/**
 * Scrydex sealed `type` -> our sealed type, with the decoy rules that keep a
 * different SKU from supplying a price. A Case is twelve boxes; a "Pokémon
 * Center Set" or "File Set" is not a booster product at all.
 */
const SEALED_TYPES: Record<string, { our: string; slug: string; mustNot: RegExp }> = {
  "booster box": { our: "booster_box", slug: "booster-box", mustNot: /\bcase\b|jumbo|set\b/i },
  "booster pack": { our: "booster_pack", slug: "booster-pack", mustNot: /\bcase\b|sleeved|set\b/i },
};

/** Packs per box, by our product type. Japanese boxes are NOT 36 packs. */
const DEFAULT_PACKS: Record<string, number> = { booster_box: 30, booster_pack: 1 };

/**
 * Japanese box sizes that are not the 30-pack default.
 *
 * Japanese boxes vary far more than English ones: a High Class set ships 10
 * packs of 10 cards, a regular expansion 30 packs of 5. Getting this wrong
 * scales the whole EV, so anything not listed here falls back to 30 and is
 * reported, rather than being silently assumed.
 */
const PACKS_PER_BOX: Record<string, number> = {
  // High Class / "fes" sets — 10 packs per box.
  SV8A: 10, SV4A: 10, SV2A: 20, S12A: 10, SV6A: 10, SV5A: 10,
  SV1A: 10, S8B: 10, S6A: 10, S4A: 10,
};

interface PcProduct {
  "product-name"?: string;
  "console-name"?: string;
  "loose-price"?: number;
}

async function getJson(url: string, headers: Record<string, string>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("gave up");
}

async function pcSearch(token: string, query: string): Promise<PcProduct[]> {
  const res = await fetch(
    `https://www.pricecharting.com/api/products?t=${token}&q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) return [];
  return ((await res.json()) as { products?: PcProduct[] }).products ?? [];
}

async function main() {
  const key = process.env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = process.env.SCRYDEX_TEAM_ID;
  const pcToken = process.env.PRICECHARTING_TOKEN;
  if (!key || !teamId || !pcToken) {
    console.error("Need TCGPLAYER_MIRROR_API_KEY, SCRYDEX_TEAM_ID and PRICECHARTING_TOKEN.");
    process.exit(1);
  }
  const headers = { "X-Api-Key": key, "X-Team-ID": teamId, accept: "application/json" };
  const prefix = process.argv[2]?.toUpperCase();

  const db = getDb();
  const [game] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  if (!game) throw new Error("pokemon game row missing");

  const jpSets = await db
    .select({ id: sets.id, code: sets.code, name: sets.name, externalIds: sets.externalIds })
    .from(sets)
    .where(and(eq(sets.gameId, game.id), eq(sets.language, "JP")));

  const targets = jpSets
    .filter((s) => s.externalIds["scrydex"])
    .filter((s) => !prefix || s.code.toUpperCase().startsWith(prefix));

  console.log(`${targets.length} Japanese sets with a Scrydex id\n`);

  let productsMade = 0;
  let pricesMade = 0;
  let assumedPacks = 0;
  const noPrice: string[] = [];

  for (const s of targets) {
    let items: { name?: string; type?: string; images?: { large?: string; medium?: string }[] }[];
    try {
      const b = await getJson(
        `${BASE}/pokemon/v1/expansions/${encodeURIComponent(s.externalIds["scrydex"]!)}/sealed?page=1&page_size=100`,
        headers,
      );
      items = b.data ?? [];
    } catch {
      continue;
    }
    if (!items.length) continue;

    for (const item of items) {
      const rule = item.type ? SEALED_TYPES[item.type.toLowerCase()] : undefined;
      if (!rule) continue;
      const name = item.name ?? "";
      if (rule.mustNot.test(name)) continue;

      // "Terastal Festival ex Booster Box" -> "Terastal Festival ex", the
      // English set name PriceCharting files the Japanese console under.
      const englishSetName = name
        .replace(/\s*Booster\s+(Box|Pack).*$/i, "")
        .trim();

      const packs =
        rule.our === "booster_pack"
          ? 1
          : (PACKS_PER_BOX[s.code.toUpperCase()] ?? DEFAULT_PACKS.booster_box!);
      if (rule.our === "booster_box" && PACKS_PER_BOX[s.code.toUpperCase()] === undefined) {
        assumedPacks++;
      }

      const [prod] = await db
        .insert(sealedProducts)
        .values({
          setId: s.id,
          name: rule.our === "booster_box" ? `Booster Box (${packs} packs)` : "Booster Pack",
          slug: rule.slug,
          type: rule.our as never,
          packsContained: packs,
          msrpCents: null,
          imageUrl: item.images?.[0]?.large ?? item.images?.[0]?.medium ?? null,
        })
        .onConflictDoUpdate({
          target: [sealedProducts.setId, sealedProducts.slug],
          set: {
            name: sql`excluded.name`,
            packsContained: sql`excluded.packs_contained`,
            imageUrl: sql`coalesce(excluded.image_url, ${sealedProducts.imageUrl})`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: sealedProducts.id });
      if (!prod) continue;
      productsMade++;

      // Japanese-market price, from PriceCharting's Japanese console.
      const wanted = rule.our === "booster_box" ? "Booster Box" : "Booster Pack";
      const hits = await pcSearch(pcToken, `Pokemon Japanese ${englishSetName} ${wanted}`);
      const match = hits.find(
        (p) =>
          /Japanese/i.test(p["console-name"] ?? "") &&
          (p["product-name"] ?? "").trim().toLowerCase() === wanted.toLowerCase(),
      );
      const cents = Number(match?.["loose-price"] ?? 0);
      if (!match || !Number.isFinite(cents) || cents <= 0) {
        noPrice.push(`${s.code} ${rule.our} (${englishSetName})`);
        continue;
      }

      const row = {
        sealedProductId: prod.id,
        sourceId: "pricecharting_ebay",
        priceCents: cents,
        kind: "sealed" as const,
        capturedAt: new Date(),
      };
      await db.insert(priceSnapshots).values([row]);
      await db
        .insert(latestPrices)
        .values([row])
        .onConflictDoUpdate({
          target: [latestPrices.sealedProductId, latestPrices.sourceId, latestPrices.kind],
          targetWhere: sql`${latestPrices.sealedProductId} IS NOT NULL`,
          set: {
            priceCents: sql`excluded.price_cents`,
            capturedAt: sql`excluded.captured_at`,
            updatedAt: new Date(),
          },
        });
      pricesMade++;
      console.log(
        `  ${s.code.padEnd(8)} ${rule.our.padEnd(12)} ${String(packs).padStart(2)} packs  $${(cents / 100).toFixed(2).padStart(8)}  ${englishSetName}`,
      );
    }
  }

  console.log(
    `\nDone. ${productsMade} sealed products, ${pricesMade} priced. ` +
      `${noPrice.length} products found no Japanese price.`,
  );
  if (assumedPacks > 0) {
    console.log(
      `WARNING: ${assumedPacks} boxes fell back to the 30-pack default because the set is not in ` +
        `PACKS_PER_BOX. Japanese box sizes vary (High Class sets are 10 packs), and pack count ` +
        `scales EV directly — verify these before ranking those sets.`,
    );
  }
  process.exit(0);
}

main();
