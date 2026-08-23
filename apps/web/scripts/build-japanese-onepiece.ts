/**
 * Japanese One Piece: mirror the English catalog, price it from PriceCharting.
 *
 * There is no licensed Japanese One Piece catalog — Scrydex carries 53 One
 * Piece expansions and every one is English. But Japanese and English One
 * Piece are the SAME card list: identical set codes, identical collector
 * numbers (OP01-120 is Shanks in both), identical rarities and printings. The
 * languages differ in print run and in price, not in structure.
 *
 * So the catalog is mirrored from the English rows we already trust, and only
 * the prices are Japanese — PriceCharting carries a "One Piece Japanese <Set>"
 * console per set, with the same "Name [Treatment] CODE" product naming the
 * English side already parses.
 *
 * Pull rates are COPIED from the English set and marked as such in the source
 * note. That is the honest weak point: Bandai does not publish odds and no
 * Japanese-specific study exists, so the assumption is that a Japanese pack
 * pulls like an English one. It is stated on every set rather than hidden, and
 * confidence is capped at the English table's own level.
 *
 * Usage: tsx --env-file=.env.local scripts/build-japanese-onepiece.ts
 */
import { and, eq, sql } from "drizzle-orm";

import {
  cards,
  games,
  getDb,
  latestPrices,
  priceSnapshots,
  pullRateTables,
  sealedProducts,
  sets,
} from "@/lib/db";

/** PriceCharting bracket -> our treatment. Mirrors the English adapter's map. */
const BRACKET_TO_TREATMENT: Record<string, string> = {
  "alternate art": "alt_art",
  "alt art": "alt_art",
  parallel: "alt_art",
  manga: "manga",
  "alternate art manga": "manga",
  "manga alternate art": "manga",
  "wanted poster": "wanted_poster",
  wanted: "wanted_poster",
  "treasure rare": "treasure_rare",
  sp: "sp",
};

const OP_CODE = /\b([A-Z]{1,3}\d{2}-\d{3})\b/;
const BRACKET = /\[([^\]]+)\]/;

/** Sealed product-name -> our sealed type. Same names as the English side. */
const SEALED_LABELS: Record<string, string> = {
  "booster box": "booster_box",
  "booster pack": "booster_pack",
};

interface PcProduct {
  "product-name"?: string;
  "console-name"?: string;
  "loose-price"?: number;
  "new-price"?: number;
}

async function pcSearch(token: string, query: string): Promise<PcProduct[]> {
  const res = await fetch(
    `https://www.pricecharting.com/api/products?t=${token}&q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { products?: PcProduct[] };
  return body.products ?? [];
}

async function main() {
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token) {
    console.error("PRICECHARTING_TOKEN missing.");
    process.exit(1);
  }

  const db = getDb();
  const [game] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "one-piece"));
  if (!game) throw new Error("one-piece game row missing — run db:seed");

  // Every English One Piece set that can rank (has an active pull table).
  const enSets = await db
    .select({
      id: sets.id,
      code: sets.code,
      name: sets.name,
      releaseDate: sets.releaseDate,
      externalIds: sets.externalIds,
    })
    .from(sets)
    .innerJoin(pullRateTables, and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)))
    .where(and(eq(sets.gameId, game.id), eq(sets.language, "EN")));

  console.log(`${enSets.length} English One Piece sets to mirror\n`);

  let setsDone = 0;
  let cardsDone = 0;
  let pricesDone = 0;
  let sealedDone = 0;
  const skipped: string[] = [];

  for (const en of enSets) {
    // PriceCharting names the console after the set, in English.
    const products = await pcSearch(token, `One Piece Japanese ${en.name}`);
    const consoleRe = new RegExp(`^One Piece Japanese ${en.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const rows = products.filter((p) => consoleRe.test(p["console-name"] ?? ""));
    if (rows.length === 0) {
      skipped.push(`${en.code} (${en.name}) — no Japanese console on PriceCharting`);
      continue;
    }

    // Mirror the set.
    const [jpSet] = await db
      .insert(sets)
      .values({
        gameId: game.id,
        code: en.code,
        name: en.name,
        language: "JP",
        releaseDate: en.releaseDate,
        externalIds: { mirroredFrom: "EN", pricecharting: `One Piece Japanese ${en.name}` },
      })
      .onConflictDoUpdate({
        target: [sets.gameId, sets.code, sets.language],
        set: {
          name: sql`excluded.name`,
          externalIds: sql`${sets.externalIds} || excluded.external_ids`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: sets.id });
    if (!jpSet) continue;
    setsDone++;

    // Mirror the card rows. Same numbers, rarities and treatments — only the
    // set (and therefore the price) differs.
    const enCards = await db
      .select({
        number: cards.number,
        name: cards.name,
        rarity: cards.rarity,
        treatment: cards.treatment,
        imageUrl: cards.imageUrl,
        displayOnly: cards.displayOnly,
      })
      .from(cards)
      .where(eq(cards.setId, en.id));

    if (enCards.length > 0) {
      const toInsert = enCards.map((c) => ({
        setId: jpSet.id,
        number: c.number,
        name: c.name,
        rarity: c.rarity,
        treatment: c.treatment,
        imageUrl: c.imageUrl,
        displayOnly: c.displayOnly,
        externalIds: {} as Record<string, string>,
      }));
      for (let i = 0; i < toInsert.length; i += 500) {
        await db
          .insert(cards)
          .values(toInsert.slice(i, i + 500))
          .onConflictDoUpdate({
            target: [cards.setId, cards.number, cards.treatment],
            set: {
              name: sql`excluded.name`,
              rarity: sql`excluded.rarity`,
              imageUrl: sql`coalesce(excluded.image_url, ${cards.imageUrl})`,
              displayOnly: sql`excluded.display_only`,
              updatedAt: new Date(),
            },
          });
      }
      cardsDone += toInsert.length;
    }

    // Japanese prices, matched on (collector number, treatment) exactly as the
    // English adapter does — the same code spans a $4 base and a $944 manga.
    const jpCards = await db
      .select({ id: cards.id, number: cards.number, treatment: cards.treatment })
      .from(cards)
      .where(eq(cards.setId, jpSet.id));
    const byKey = new Map(jpCards.map((c) => [`${c.number}|${c.treatment}`, c.id]));

    const priceRows: {
      cardId: string;
      sourceId: string;
      priceCents: number;
      kind: "raw";
      capturedAt: Date;
    }[] = [];
    const sealedByType = new Map<string, number>();

    for (const p of rows) {
      const nameField = (p["product-name"] ?? "").trim();
      const cents = Number(p["loose-price"] ?? 0);
      if (!nameField || !Number.isFinite(cents) || cents <= 0) continue;

      const sealedType = SEALED_LABELS[nameField.toLowerCase().trim()];
      if (sealedType) {
        sealedByType.set(sealedType, cents);
        continue;
      }

      const code = OP_CODE.exec(nameField)?.[1];
      if (!code) continue;
      const bracket = BRACKET.exec(nameField)?.[1]?.toLowerCase().trim();
      // No bracket = the base printing. An unmapped bracket is a promo or
      // tournament printing we deliberately do not price — see the English
      // adapter's note: a wrong price is worse than a missing one.
      const treatment = bracket === undefined ? "base" : BRACKET_TO_TREATMENT[bracket];
      if (!treatment) continue;

      const cardId = byKey.get(`${code}|${treatment}`);
      if (!cardId) continue;
      priceRows.push({
        cardId,
        sourceId: "pricecharting_ebay",
        priceCents: cents,
        kind: "raw",
        capturedAt: new Date(),
      });
    }

    // One row per card: PriceCharting can list a code twice across printings we
    // both map, and the last write would otherwise win arbitrarily. Keep the
    // first, which is the plain base/treatment match.
    const seen = new Set<string>();
    const deduped = priceRows.filter((r) => {
      if (seen.has(r.cardId)) return false;
      seen.add(r.cardId);
      return true;
    });

    for (let i = 0; i < deduped.length; i += 500) {
      const chunk = deduped.slice(i, i + 500);
      await db.insert(priceSnapshots).values(chunk);
      await db
        .insert(latestPrices)
        .values(chunk)
        .onConflictDoUpdate({
          target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
          targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
          set: {
            priceCents: sql`excluded.price_cents`,
            capturedAt: sql`excluded.captured_at`,
            updatedAt: new Date(),
          },
        });
    }
    pricesDone += deduped.length;

    // Sealed products, mirroring the English pack counts.
    for (const [type, cents] of sealedByType) {
      const [enProd] = await db
        .select({ packsContained: sealedProducts.packsContained, name: sealedProducts.name })
        .from(sealedProducts)
        .where(and(eq(sealedProducts.setId, en.id), eq(sealedProducts.type, type as never)));
      const [prod] = await db
        .insert(sealedProducts)
        .values({
          setId: jpSet.id,
          name: enProd?.name ?? (type === "booster_box" ? "Booster Box" : "Booster Pack"),
          slug: type === "booster_box" ? "booster-box" : "booster-pack",
          type: type as never,
          packsContained: enProd?.packsContained ?? (type === "booster_box" ? 24 : 1),
          msrpCents: null,
        })
        .onConflictDoUpdate({
          target: [sealedProducts.setId, sealedProducts.slug],
          set: { updatedAt: new Date() },
        })
        .returning({ id: sealedProducts.id });
      if (!prod) continue;

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
      sealedDone++;
    }

    console.log(
      `  ${en.code.padEnd(6)} ${String(cardsDone && enCards.length).padStart(4)} cards, ${String(deduped.length).padStart(4)} priced, ${sealedByType.size} sealed  ${en.name}`,
    );
  }

  console.log(
    `\nDone. ${setsDone} Japanese sets, ${cardsDone} cards, ${pricesDone} card prices, ${sealedDone} sealed prices.`,
  );
  if (skipped.length) {
    console.log(`\nSkipped (no Japanese data):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  console.log(
    `\nNOTE: no pull tables were created. Japanese One Piece reuses the English card\n` +
      `structure, but whether it also reuses English ODDS is a judgement call that\n` +
      `belongs in a data file with its own source note, not in this script.`,
  );
  process.exit(0);
}

main();
