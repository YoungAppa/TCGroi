/**
 * Enrich the Simplified Chinese Gem Pack sets with (a) card IMAGES and (b) the
 * COMPLETE card list — the two things PriceCharting can't give us.
 *
 * PriceCharting has prices + English names but no images, and our build drops
 * sub-$1 cards, so the Gem Pack catalogs were image-less and slightly short.
 * tcg.mik.moe (Cryst's Cards Database) has the full official Simplified Chinese
 * card list WITH images at a stable CDN — and its card numbers line up 1:1 with
 * PriceCharting's once leading zeros are normalised (verified 115/115 on Vol.1).
 *
 * This is NON-DESTRUCTIVE: it only upserts cards into the five Gem Pack sets and
 * never drops a set/table/product (unlike the full rebuild). Idempotent. Card
 * rarity is left untouched, so the cn_chase tags the ranking relies on survive.
 *
 *   npx tsx --env-file=.env.local scripts/enrich-chinese-gempacks.ts
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { cards, games, getDb, latestPrices, sets } from "@/lib/db";
import { getEnv } from "@/lib/env";

// Our set code  ->  { PriceCharting console suffix, tcg.mik.moe setId }.
const GEM_PACKS: Record<string, { console: string; mikId: string }> = {
  "gem-pack": { console: "Gem Pack", mikId: "CBB1C" },
  "gem-pack-2": { console: "Gem Pack 2", mikId: "CBB2C" },
  "gem-pack-3": { console: "Gem Pack 3", mikId: "CBB3C" },
  "gem-pack-4": { console: "Gem Pack 4", mikId: "CBB4C" },
  "gem-pack-5": { console: "Gem Pack 5", mikId: "CBB5C" },
};

const MIK_BASE = "https://tcg.mik.moe";
const CONSOLE_PREFIX = "Pokemon Chinese ";
const TREATMENT: Record<string, string> = {
  "master ball": "master_ball",
  "poke ball": "poke_ball",
  reverse: "reverse",
  "cosmos holo": "cosmos",
};

/** Normalise a collector number for cross-source matching: drop leading zeros. */
const norm = (n: string) => n.replace(/^0+(?=\d)/, "");

/** Split a PriceCharting CSV line into console / product / price. */
function splitRow(line: string): { console: string; product: string; cents: number | null } | null {
  const first = line.indexOf(",");
  if (first < 0) return null;
  const second = line.indexOf(",", first + 1);
  const last = line.lastIndexOf(",");
  if (second < 0 || last <= second) return null;
  const consoleName = line.slice(first + 1, second);
  const product = line.slice(second + 1, last);
  const priceStr = line.slice(last + 1).trim();
  const dollars = priceStr.startsWith("$") ? Number(priceStr.slice(1).replace(/,/g, "")) : NaN;
  return { console: consoleName, product, cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : null };
}

/** "Crocalor [Full Art] #408" -> {name, number, treatment}. Null if not a card. */
function parseCard(product: string): { name: string; number: string; treatment: string } | null {
  const num = product.match(/#\s*([A-Za-z0-9]+)\s*$/);
  if (!num) return null;
  const variant = product.match(/\[([^\]]+)\]/);
  const treatment = variant ? (TREATMENT[variant[1]!.toLowerCase()] ?? "special") : "base";
  const name = product
    .replace(/\s*#\s*[A-Za-z0-9]+\s*$/, "")
    .replace(/\s*\[[^\]]+\]\s*/, " ")
    .trim();
  return { name: name || "Unknown", number: num[1]!, treatment };
}

const mikResponse = z.object({
  data: z.object({
    cards: z.array(
      z.object({ cardIndex: z.string(), cardName: z.string().nullish(), rarity: z.string().nullish() }),
    ),
  }),
});

/**
 * Fetch tcg.mik.moe's full card list: normalised number -> {cardIndex, rarity}.
 * rarity is the OFFICIAL Chinese star grade (●, ◆, ★, ★★, ★★★) — the ★★★ set is
 * the true three-star chase pool the disclosed odd applies to (more reliable than
 * inferring it from price bands).
 */
async function fetchMikIndex(mikId: string): Promise<Map<string, { cardIndex: string; rarity: string | null }>> {
  const res = await fetch(`${MIK_BASE}/api/v3/card/product-detail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setId: mikId }),
  });
  if (!res.ok) throw new Error(`tcg.mik.moe ${mikId}: HTTP ${res.status}`);
  const { data } = mikResponse.parse(await res.json());
  const map = new Map<string, { cardIndex: string; rarity: string | null }>();
  for (const c of data.cards) map.set(norm(c.cardIndex), { cardIndex: c.cardIndex, rarity: c.rarity ?? null });
  return map;
}

interface Row {
  name: string;
  number: string;
  treatment: string;
  cents: number;
}

async function main() {
  const token = getEnv().PRICECHARTING_TOKEN;
  if (!token) throw new Error("PRICECHARTING_TOKEN is not configured");
  const db = getDb();
  const [pokemon] = await db.select().from(games).where(eq(games.slug, "pokemon"));
  if (!pokemon) throw new Error("pokemon game not seeded");

  console.log("Downloading PriceCharting pokemon-cards CSV…");
  const res = await fetch(
    `https://www.pricecharting.com/price-guide/download-custom?t=${encodeURIComponent(token)}&category=pokemon-cards`,
  );
  if (!res.ok) throw new Error(`PriceCharting download failed: HTTP ${res.status}`);
  const csv = await res.text();

  // Group every Gem Pack card row (NO price floor — we want the full list).
  const byConsole = new Map<string, Row[]>();
  for (const line of csv.split("\n")) {
    if (!line.includes(CONSOLE_PREFIX)) continue;
    const parsed = splitRow(line);
    if (!parsed || !parsed.console.startsWith(CONSOLE_PREFIX) || parsed.cents === null) continue;
    const suffix = parsed.console.slice(CONSOLE_PREFIX.length).trim();
    const card = parseCard(parsed.product);
    if (!card) continue;
    (byConsole.get(suffix) ?? byConsole.set(suffix, []).get(suffix)!).push({ ...card, cents: parsed.cents });
  }

  const capturedAt = new Date();
  for (const [code, { console: suffix, mikId }] of Object.entries(GEM_PACKS)) {
    const [setRow] = await db
      .select({ id: sets.id })
      .from(sets)
      .where(and(eq(sets.gameId, pokemon.id), eq(sets.code, code), eq(sets.language, "ZH")));
    if (!setRow) {
      console.warn(`  ${code}: set not in DB — skipped`);
      continue;
    }

    const mikIndex = await fetchMikIndex(mikId);

    // Full card list from PriceCharting, deduped by (number, treatment).
    const rows = byConsole.get(suffix) ?? [];
    const byKey = new Map<string, Row>();
    for (const r of rows) {
      const k = `${r.number}|${r.treatment}`;
      const ex = byKey.get(k);
      if (!ex || r.cents > ex.cents) byKey.set(k, r);
    }
    const unique = [...byKey.values()];

    let withImage = 0;
    let withRarity = 0;
    const values = unique.map((r) => {
      const mik = mikIndex.get(norm(r.number));
      const imageUrl = mik ? `${MIK_BASE}/static/img/${mikId}/${mik.cardIndex}.png` : null;
      if (imageUrl) withImage++;
      // Persist the official star grade so the chase tagging reads it (not price).
      const externalIds: Record<string, string> = mik?.rarity ? { mik_rarity: mik.rarity } : {};
      if (mik?.rarity) withRarity++;
      return { setId: setRow.id, name: r.name, number: r.number, treatment: r.treatment, imageUrl, externalIds };
    });

    // Upsert cards: insert the missing (sub-$1) ones; set imageUrl + merge the
    // star rarity into externalIds on all. DO NOT touch `rarity` — the cn_chase
    // tags (set by tag-gempack-chase) must survive a re-run.
    const inserted = await db
      .insert(cards)
      .values(values.map((v) => ({ ...v, rarity: "unknown" })))
      .onConflictDoUpdate({
        target: [cards.setId, cards.number, cards.treatment],
        set: {
          imageUrl: sql`excluded.image_url`,
          externalIds: sql`${cards.externalIds} || excluded.external_ids`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: cards.id, number: cards.number, treatment: cards.treatment });
    void withRarity;

    // Prices (idempotent): every card gets its PriceCharting market price.
    const idByKey = new Map(inserted.map((r) => [`${r.number}|${r.treatment}`, r.id]));
    const priceRows = unique
      .map((r) => ({ cardId: idByKey.get(`${r.number}|${r.treatment}`), cents: r.cents }))
      .filter((r): r is { cardId: string; cents: number } => typeof r.cardId === "string");
    if (priceRows.length > 0) {
      await db
        .insert(latestPrices)
        .values(priceRows.map((r) => ({ cardId: r.cardId, sourceId: "pricecharting_ebay", priceCents: r.cents, kind: "raw" as const, capturedAt })))
        .onConflictDoUpdate({
          target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
          targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
          set: { priceCents: sql`excluded.price_cents`, capturedAt, updatedAt: new Date() },
        });
    }

    console.log(`  ${code} (${mikId}): ${unique.length} cards upserted, ${withImage} with images.`);
  }

  console.log("\nDone: Gem Pack catalogs completed + imaged from tcg.mik.moe.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("enrich-chinese-gempacks failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
