/**
 * Fill in the sealed products older sets were missing: Elite Trainer Boxes for
 * every set that actually had one, plus premium collections whose contents are
 * stated by the publisher.
 *
 * What decides inclusion — the same sourcing bar as everything else:
 *   - An ETB is created only where SCRYDEX lists one for that set (37 sets do;
 *     the WOTC/DP/Platinum/early-BW eras predate ETBs and correctly get none,
 *     and xy2 genuinely never had one).
 *   - A premium collection is created only when its OWN description states the
 *     pack count AND the set the packs come from. Prismatic Evolutions'
 *     Super-Premium Collection qualifies verbatim ("15 Pokémon TCG: Scarlet &
 *     Violet—Prismatic Evolutions booster packs"). The Charizard UPC ("16
 *     booster packs from the Sword & Shield Series") and Arceus UPC ("15
 *     Pokémon TCG booster packs") are ASSORTED — no fixed composition exists to
 *     rank against, the same reason the Greninja and Terapagos UPCs were
 *     rejected earlier — so they are reported and skipped, not guessed at.
 *
 * ETB pack counts are a product-line constant, not per-set trivia: every ETB
 * from the format's introduction (late Black & White) through Sword & Shield
 * contained 8 booster packs, and Scarlet & Violet onward contain 9-10 (9 for
 * the sets here). This is the same class of fact as "an English booster box is
 * 36 packs", which the site already relies on.
 *
 * Prices come from PriceCharting with the console-name check learned from the
 * Pokémon Center bug: the console must be THIS set's, and where a set ships
 * only named ETB variants the median of them (excluding Pokémon Center
 * editions) prices the standard box. Art comes from Scrydex.
 *
 * Usage: tsx --env-file=.env.local scripts/topup-etbs-and-collections.ts
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

const H = {
  "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!,
  "X-Team-ID": process.env.SCRYDEX_TEAM_ID!,
  accept: "application/json",
};

/** ETB pack count by era prefix. See the header comment for why this is safe. */
const ERA_ETB_PACKS: [RegExp, number][] = [
  [/^(bw|xy|sm|swsh)/i, 8],
  [/^(sv|rsv|zsv|me)/i, 9],
];

interface PcProduct {
  "product-name"?: string;
  "console-name"?: string;
  "loose-price"?: number;
}

async function pcSearch(q: string): Promise<PcProduct[]> {
  const res = await fetch(
    `https://www.pricecharting.com/api/products?t=${process.env.PRICECHARTING_TOKEN}&q=${encodeURIComponent(q)}`,
  );
  if (!res.ok) return [];
  return ((await res.json()) as { products?: PcProduct[] }).products ?? [];
}

/** Standard-ETB price for a set: exact row first, else median of named variants. */
async function etbPriceCents(setName: string): Promise<number | null> {
  const hits = await pcSearch(`Pokemon ${setName} Elite Trainer Box`);
  const mine = hits.filter(
    (p) =>
      (p["console-name"] ?? "").trim().toLowerCase() === `pokemon ${setName}`.toLowerCase() &&
      /^elite trainer box/i.test((p["product-name"] ?? "").trim()) &&
      !/\bcase\b|pokemon\s*center|plus\b/i.test(p["product-name"] ?? "") &&
      Number(p["loose-price"] ?? 0) > 0,
  );
  if (mine.length === 0) return null;
  const exact = mine.find((p) => /^elite trainer box\s*$/i.test((p["product-name"] ?? "").trim()));
  if (exact) return Number(exact["loose-price"]);
  const sorted = mine.map((p) => Number(p["loose-price"])).sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

async function scrydexSealed(expId: string) {
  const r = await fetch(
    `https://api.scrydex.com/pokemon/v1/expansions/${encodeURIComponent(expId)}/sealed?page=1&page_size=100`,
    { headers: H },
  );
  if (!r.ok) return [];
  return ((await r.json()).data ?? []) as {
    name?: string;
    type?: string;
    description?: string;
    images?: { large?: string; medium?: string }[];
  }[];
}

async function writeSealedPrice(db: ReturnType<typeof getDb>, productId: string, cents: number) {
  const row = {
    sealedProductId: productId,
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
}

async function main() {
  if (!process.env.PRICECHARTING_TOKEN || !H["X-Api-Key"]) {
    console.error("Need PRICECHARTING_TOKEN + Scrydex credentials.");
    process.exit(1);
  }
  const db = getDb();
  const [game] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  if (!game) throw new Error("pokemon game row missing");

  const ranked = await db
    .select({ id: sets.id, code: sets.code, name: sets.name, externalIds: sets.externalIds })
    .from(sets)
    .where(and(eq(sets.gameId, game.id), eq(sets.language, "EN")));

  let etbsMade = 0;
  let etbsPriced = 0;
  const skippedNoEra: string[] = [];
  const skippedNoPrice: string[] = [];
  const assorted: string[] = [];

  for (const s of ranked) {
    const items = await scrydexSealed(s.externalIds["pokemontcg_io"] ?? s.code);
    if (!items.length) continue;

    // ---- ETB ---------------------------------------------------------------
    const haveEtb = await db
      .select({ id: sealedProducts.id })
      .from(sealedProducts)
      .where(and(eq(sealedProducts.setId, s.id), eq(sealedProducts.slug, "elite-trainer-box")));
    const scryEtb = items.find(
      (i) =>
        /elite trainer box/i.test(i.type ?? "") &&
        !/\bcase\b|exclusive|pokemon center|plus\b/i.test(i.name ?? ""),
    );
    if (haveEtb.length === 0 && scryEtb) {
      const era = ERA_ETB_PACKS.find(([re]) => re.test(s.code));
      if (!era) {
        skippedNoEra.push(s.code);
      } else {
        const packs = era[1];
        const [prod] = await db
          .insert(sealedProducts)
          .values({
            setId: s.id,
            name: `Elite Trainer Box (${packs} packs)`,
            slug: "elite-trainer-box",
            type: "etb",
            packsContained: packs,
            msrpCents: null,
            imageUrl: scryEtb.images?.[0]?.large ?? scryEtb.images?.[0]?.medium ?? null,
          })
          .onConflictDoNothing({ target: [sealedProducts.setId, sealedProducts.slug] })
          .returning({ id: sealedProducts.id });
        if (prod) {
          etbsMade++;
          const cents = await etbPriceCents(s.name);
          if (cents !== null) {
            await writeSealedPrice(db, prod.id, cents);
            etbsPriced++;
            console.log(
              `  ETB  ${s.code.padEnd(8)} ${packs} packs  $${(cents / 100).toFixed(2).padStart(8)}  ${s.name}`,
            );
          } else {
            skippedNoPrice.push(s.code);
            console.log(`  ETB  ${s.code.padEnd(8)} ${packs} packs  (no price found)  ${s.name}`);
          }
        }
      }
    }

    // ---- Premium collections ----------------------------------------------
    for (const i of items) {
      if (!/ultra.?premium|super.?premium/i.test(i.name ?? "")) continue;
      if (/\bcase\b/i.test(i.name ?? "")) continue;
      const d = String(i.description ?? "").replace(/\s+/g, " ");
      // The count AND the set must be stated together — "15 Pokémon TCG:
      // Scarlet & Violet—Prismatic Evolutions booster packs" qualifies; a bare
      // "16 booster packs from the Sword & Shield Series" is assorted.
      const m = /(\d+)\s+Pok[eé]mon TCG:\s*([^•]*?)booster packs/i.exec(d);
      if (!m) {
        if (/booster packs?/i.test(d)) assorted.push(`${s.code}: ${String(i.name).slice(0, 60)}`);
        continue;
      }
      const packs = Number(m[1]);
      const statedSet = m[2]!.trim();
      // The stated expansion must BE this set, else it belongs elsewhere.
      if (!statedSet.toLowerCase().includes(s.name.toLowerCase())) {
        assorted.push(`${s.code}: ${String(i.name).slice(0, 60)} (packs are "${statedSet}")`);
        continue;
      }
      const isSuper = /super.?premium/i.test(i.name ?? "");
      const slug = isSuper ? "super-premium-collection" : "ultra-premium-collection";
      const label = isSuper ? "Super-Premium Collection" : "Ultra-Premium Collection";
      const [prod] = await db
        .insert(sealedProducts)
        .values({
          setId: s.id,
          name: `${label} (${packs} packs)`,
          slug,
          type: "case",
          packsContained: packs,
          msrpCents: null,
          imageUrl: i.images?.[0]?.large ?? i.images?.[0]?.medium ?? null,
          contentsNote:
            `Contents per the publisher's own listing: ${packs} ${s.name} booster packs plus ` +
            `accessories and promo cards. The promos and accessories are not priced into EV.`,
        })
        .onConflictDoNothing({ target: [sealedProducts.setId, sealedProducts.slug] })
        .returning({ id: sealedProducts.id });
      if (!prod) continue;
      const hits = await pcSearch(`Pokemon ${s.name} ${label.replace("-", " ")}`);
      const mine = hits.find(
        (p) =>
          (p["console-name"] ?? "").trim().toLowerCase() === `pokemon ${s.name}`.toLowerCase() &&
          /premium collection/i.test(p["product-name"] ?? "") &&
          !/\bcase\b|japanese/i.test(p["product-name"] ?? "") &&
          Number(p["loose-price"] ?? 0) > 0,
      );
      if (mine) await writeSealedPrice(db, prod.id, Number(mine["loose-price"]));
      console.log(
        `  UPC  ${s.code.padEnd(8)} ${packs} packs  ${mine ? "$" + (Number(mine["loose-price"]) / 100).toFixed(2) : "(no price)"}  ${i.name}`,
      );
    }
  }

  // ---- Moltres UPC art (created earlier from the data file, without an image)
  const sv10 = ranked.find((s) => s.code === "sv10");
  if (sv10) {
    const items = await scrydexSealed(sv10.externalIds["pokemontcg_io"] ?? "sv10");
    const moltres = items.find((i) => /moltres/i.test(i.name ?? ""));
    const img = moltres?.images?.[0]?.large ?? moltres?.images?.[0]?.medium;
    if (img) {
      await db
        .update(sealedProducts)
        .set({ imageUrl: img, updatedAt: new Date() })
        .where(
          and(
            eq(sealedProducts.setId, sv10.id),
            eq(sealedProducts.slug, "team-rockets-moltres-ex-ultra-premium-collection"),
          ),
        );
      console.log(`  ART  sv10 Moltres UPC image filled`);
    }
  }

  console.log(
    `\nDone. ${etbsMade} ETBs created (${etbsPriced} priced, ${skippedNoPrice.length} without a price yet).`,
  );
  if (skippedNoEra.length) console.log(`Skipped, unknown era pack count: ${skippedNoEra.join(", ")}`);
  if (assorted.length) {
    console.log(
      `\nPremium collections with ASSORTED or unstated pack composition — cannot rank, not created:`,
    );
    for (const a of assorted) console.log(`  ${a}`);
  }
  process.exit(0);
}

main();
