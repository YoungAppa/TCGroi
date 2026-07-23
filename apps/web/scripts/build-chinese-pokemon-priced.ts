/**
 * Rebuild the Simplified Chinese Pokémon catalog from PriceCharting — which,
 * unlike TCGdex's zh-cn feed (names-only, no prices, sparse), carries the full
 * card list WITH real market prices under "Pokemon Chinese <set>" consoles. That
 * makes the ZH cards actually valuable in the collection tracker, and unblocks a
 * real Chinese ROI (prices + the official on-pack odds Chinese packs disclose).
 *
 * Supersedes build-chinese-pokemon-catalog.ts (TCGdex). This DELETES the old ZH
 * sets first (cards cascade) and rebuilds from PriceCharting: one set per console,
 * cards > $1 with their best price, treatment derived from the [Master Ball] /
 * [Poke Ball] / [Reverse] tag. No images (PriceCharting has none). Idempotent.
 *
 * Needs PRICECHARTING_TOKEN. Requires migration 0004 (set_language += 'ZH').
 *
 *   npx tsx --env-file=.env.local scripts/build-chinese-pokemon-priced.ts
 *   npx tsx --env-file=.env.local scripts/build-chinese-pokemon-priced.ts --floor 100
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { cards, games, getDb, latestPrices, sets } from "@/lib/db";
import { getEnv } from "@/lib/env";

const CONSOLE_PREFIX = "Pokemon Chinese ";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Split a PriceCharting CSV line into id / console / product / price. */
function splitRow(line: string): { console: string; product: string; cents: number | null } | null {
  const first = line.indexOf(",");
  const last = line.lastIndexOf(",");
  if (first < 0 || last <= first) return null;
  const consoleName = line.slice(first + 1, line.indexOf(",", first + 1));
  const cStart = first + 1 + consoleName.length + 1;
  const product = line.slice(cStart, last);
  const priceStr = line.slice(last + 1).trim();
  const dollars = priceStr.startsWith("$") ? Number(priceStr.slice(1).replace(/,/g, "")) : NaN;
  return { console: consoleName, product, cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : null };
}

const TREATMENT: Record<string, string> = {
  "master ball": "master_ball",
  "poke ball": "poke_ball",
  reverse: "reverse",
  "cosmos holo": "cosmos",
};

/** "Charizard ex [Master Ball] #223" -> {name, number, treatment}. Null if not a card. */
function parseCard(product: string): { name: string; number: string; treatment: string } | null {
  const num = product.match(/#\s*([A-Za-z0-9]+)\s*$/);
  if (!num) return null; // sealed product (Booster Box, ETB, …) — no card number
  const number = num[1]!;
  const variant = product.match(/\[([^\]]+)\]/);
  const treatment = variant ? (TREATMENT[variant[1]!.toLowerCase()] ?? "special") : "base";
  const name = product
    .replace(/\s*#\s*[A-Za-z0-9]+\s*$/, "")
    .replace(/\s*\[[^\]]+\]\s*/, " ")
    .trim();
  return { name: name || "Unknown", number, treatment };
}

function slug(consoleSuffix: string): string {
  return consoleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
  const floorCents = Number(arg("--floor") ?? "100");
  const [pokemon] = await db.select().from(games).where(eq(games.slug, "pokemon"));
  if (!pokemon) throw new Error("pokemon game not seeded");

  console.log("Downloading PriceCharting pokemon-cards CSV…");
  const res = await fetch(
    `https://www.pricecharting.com/price-guide/download-custom?t=${encodeURIComponent(token)}&category=pokemon-cards`,
  );
  if (!res.ok) throw new Error(`PriceCharting download failed: HTTP ${res.status}`);
  const csv = await res.text();

  // Group Chinese card rows by console (= set).
  const bySet = new Map<string, { name: string; rows: Row[] }>();
  for (const line of csv.split("\n")) {
    if (!line.includes(CONSOLE_PREFIX)) continue;
    const parsed = splitRow(line);
    if (!parsed || !parsed.console.startsWith(CONSOLE_PREFIX) || parsed.cents === null) continue;
    if (parsed.cents < floorCents) continue;
    const card = parseCard(parsed.product);
    if (!card) continue;
    const suffix = parsed.console.slice(CONSOLE_PREFIX.length).trim();
    const code = slug(suffix);
    if (!code) continue;
    let entry = bySet.get(code);
    if (!entry) bySet.set(code, (entry = { name: suffix, rows: [] }));
    entry.rows.push({ ...card, cents: parsed.cents });
  }
  console.log(`${bySet.size} Simplified Chinese sets with priced cards ≥ $${(floorCents / 100).toFixed(2)}.`);

  // Clean slate: drop the old (TCGdex) ZH sets so codes/prices don't collide.
  const oldZh = await db
    .select({ id: sets.id })
    .from(sets)
    .where(and(eq(sets.gameId, pokemon.id), eq(sets.language, "ZH")));
  if (oldZh.length > 0) {
    await db.delete(sets).where(inArray(sets.id, oldZh.map((s) => s.id)));
    console.log(`Cleared ${oldZh.length} pre-existing ZH sets.`);
  }

  let setsDone = 0;
  let cardsStored = 0;
  const capturedAt = new Date();

  for (const [code, { name, rows }] of bySet) {
    // Dedupe by (number, treatment); keep the dearer copy.
    const byKey = new Map<string, Row>();
    for (const r of rows) {
      const k = `${r.number}|${r.treatment}`;
      const ex = byKey.get(k);
      if (!ex || r.cents > ex.cents) byKey.set(k, r);
    }
    const unique = [...byKey.values()];

    const [setRow] = await db
      .insert(sets)
      .values({ gameId: pokemon.id, code, name, language: "ZH", externalIds: { pricecharting: name } })
      .onConflictDoUpdate({ target: [sets.gameId, sets.code, sets.language], set: { name, updatedAt: new Date() } })
      .returning({ id: sets.id });
    const setId = setRow!.id;

    const inserted = await db
      .insert(cards)
      .values(
        unique.map((r) => ({
          setId,
          name: r.name,
          number: r.number,
          rarity: "unknown",
          treatment: r.treatment,
          imageUrl: null,
          externalIds: {},
        })),
      )
      .returning({ id: cards.id, number: cards.number, treatment: cards.treatment });

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

    cardsStored += unique.length;
    setsDone++;
  }

  console.log(`\nDone: ${setsDone} ZH sets, ${cardsStored} priced cards stored (PriceCharting).`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("chinese pokemon priced build failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
