/**
 * Pokémon Center exclusive Elite Trainer Boxes (English).
 *
 * A Pokémon Center ETB is the standard Elite Trainer Box with exclusive
 * artwork, a different deck box and different promo cards. Its packs are the
 * same packs, so opening it is worth the same as opening the standard ETB —
 * while it costs two to three times as much (Prismatic Evolutions: $444 against
 * $151). That gap is exactly the sort of thing this site exists to show, and it
 * cannot be seen unless the product is listed.
 *
 * Sourcing:
 *   - Scrydex does NOT carry these as distinct products (it has the Pokémon
 *     Center *cases*, and regular ETBs whose marketing copy says "exclusive"),
 *     so it cannot supply them.
 *   - PriceCharting does, as "Elite Trainer Box [Pokemon Center]" under the
 *     set's own console, with a price.
 *
 * PACK COUNT is the one input neither source states — English ETB descriptions
 * are marketing copy with no contents. It is taken from the SAME SET's standard
 * ETB, which is what "same box, exclusive art" means. That assumption is either
 * exact or conservative: a premium edition never contains FEWER packs than the
 * standard one, so if it is wrong at all it understates this product's EV
 * rather than inflating it. The assumption is recorded on each product's
 * contentsNote so a reader can see it.
 *
 * A product is only created when BOTH exist: the set's standard ETB (to take
 * the pack count from) and a Pokémon Center price row. No guessing either way.
 *
 * Usage: tsx --env-file=.env.local scripts/build-pokemon-center-products.ts
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

const SLUG = "elite-trainer-box-pokemon-center";

/** set.code -> PriceCharting console, where "Pokemon <set.name>" is wrong. */
const PK_CONSOLE_OVERRIDE: Record<string, string> = {
  sv3pt5: "Pokemon Scarlet & Violet 151",
};

interface PcProduct {
  "product-name"?: string;
  "console-name"?: string;
  "loose-price"?: number;
}

async function pcSearch(token: string, query: string): Promise<PcProduct[]> {
  const res = await fetch(
    `https://www.pricecharting.com/api/products?t=${token}&q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) return [];
  return ((await res.json()) as { products?: PcProduct[] }).products ?? [];
}

async function main() {
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token) {
    console.error("PRICECHARTING_TOKEN missing.");
    process.exit(1);
  }

  const db = getDb();
  const [game] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  if (!game) throw new Error("pokemon game row missing");

  // Sets that have a standard ETB — the only ones we can source a pack count for.
  const rows = await db
    .select({
      setId: sets.id,
      code: sets.code,
      name: sets.name,
      etbId: sealedProducts.id,
      packs: sealedProducts.packsContained,
      msrp: sealedProducts.msrpCents,
    })
    .from(sets)
    .innerJoin(
      sealedProducts,
      and(eq(sealedProducts.setId, sets.id), eq(sealedProducts.slug, "elite-trainer-box")),
    )
    .where(and(eq(sets.gameId, game.id), eq(sets.language, "EN")));

  console.log(`${rows.length} English sets with a standard ETB to compare against\n`);

  let made = 0;
  let pricedCount = 0;
  const noPcRow: string[] = [];

  for (const s of rows) {
    const hits = await pcSearch(token, `Pokemon ${s.name} Elite Trainer Box Pokemon Center`);

    // The console name must be THIS set's. PriceCharting's search is fuzzy and
    // happily returns another set's Pokémon Center box first — querying "Mega
    // Evolution" leads with Chaos Rising's $127.77 while Mega Evolution's own
    // editions are $227.13 and $203.96. Matching on product name alone wrote
    // one set's price onto another.
    const wantConsole = (PK_CONSOLE_OVERRIDE[s.code] ?? `Pokemon ${s.name}`).toLowerCase();
    const mine = hits.filter(
      (p) =>
        (p["console-name"] ?? "").trim().toLowerCase() === wantConsole &&
        /pokemon\s*center/i.test(p["product-name"] ?? "") &&
        /elite trainer box/i.test(p["product-name"] ?? "") &&
        // A Case is several boxes, a different product entirely.
        !/\bcase\b/i.test(p["product-name"] ?? "") &&
        Number(p["loose-price"] ?? 0) > 0,
    );
    if (mine.length === 0) {
      noPcRow.push(s.code);
      continue;
    }

    // Some sets ship several Pokémon Center editions (Mega Evolution has a
    // Lucario and a Gardevoir box). They are the same product in different art,
    // so the median is the honest figure rather than whichever sorted first.
    const sorted = mine.map((p) => Number(p["loose-price"])).sort((a, b) => a - b);
    const cents = sorted[Math.floor((sorted.length - 1) / 2)]!;

    const [prod] = await db
      .insert(sealedProducts)
      .values({
        setId: s.setId,
        name: `Elite Trainer Box — Pokémon Center (${s.packs} packs)`,
        slug: SLUG,
        type: "etb",
        packsContained: s.packs,
        // The Pokémon Center edition has its own retail price, which we do not
        // hold; leaving it null is honest and the market price carries the ROI.
        msrpCents: null,
        contentsNote:
          "Pokémon Center exclusive edition: the same booster packs as the standard Elite " +
          "Trainer Box, with exclusive artwork, deck box and promo cards. Pack count is taken " +
          "from this set's standard ETB, since neither source states the contents of the " +
          "exclusive edition separately — a premium edition never holds fewer packs than the " +
          "standard one, so if that is wrong it understates this product rather than inflating " +
          "it. The exclusive promos are not priced into EV.",
      })
      .onConflictDoUpdate({
        target: [sealedProducts.setId, sealedProducts.slug],
        set: {
          name: sql`excluded.name`,
          packsContained: sql`excluded.packs_contained`,
          contentsNote: sql`excluded.contents_note`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: sealedProducts.id });
    if (!prod) continue;
    made++;

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
    pricedCount++;
    console.log(
      `  ${s.code.padEnd(9)} ${String(s.packs).padStart(2)} packs  PC $${(cents / 100).toFixed(2).padStart(8)}  ${s.name}`,
    );
  }

  console.log(
    `\nDone. ${made} Pokémon Center ETBs, ${pricedCount} priced. ` +
      `${noPcRow.length} sets have no Pokémon Center listing (expected — not every set gets one).`,
  );
  process.exit(0);
}

main();
