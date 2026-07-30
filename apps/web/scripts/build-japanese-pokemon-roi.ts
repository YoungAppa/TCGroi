/**
 * Turn the (names-only) Japanese Pokémon catalog into a rankable ROI dataset for
 * a chosen batch of flagship sets. The JP cards already exist (from
 * build-japanese-pokemon-catalog, via TCGdex) with Japanese names + images but
 * rarity 'unknown' and no prices. This script fills the two missing pieces:
 *
 *   1. RARITIES — TCGdex carries them per card (the set endpoint omits them, so
 *      we fetch card details), normalised with the same map the English catalog
 *      uses (TCGdex speaks the same English rarity vocabulary as pokemontcg.io).
 *   2. PRICES — PriceCharting's "Pokemon Japanese <set>" consoles list every
 *      card by number with a real market price; we match our TCGdex cards by
 *      number and write raw prices (source pricecharting_ebay).
 *
 * Pull-rate tables + box products live in data/ (jp-*.json + products) and load
 * via load-pullrates-products. Confidence is LOW — JP odds reuse the EN-era
 * shape. Idempotent; safe to re-run.
 *
 *   npx tsx --env-file=.env.local scripts/build-japanese-pokemon-roi.ts
 */
import { readFile } from "node:fs/promises";

import { and, eq, sql } from "drizzle-orm";

import { normalizePokemonRarity } from "@/lib/catalog/normalize";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

/** JP set code (TCGdex / our DB) -> PriceCharting "Pokemon Japanese <suffix>". */
const SET_MAP: Record<string, string> = {
  SV2a: "Scarlet & Violet 151",
  S12a: "VSTAR Universe",
  SV4a: "Raging Surf",
  SV3: "Ruler of the Black Flame",
  S9: "Star Birth",
};

const PC_CONSOLE_PREFIX = "Pokemon Japanese ";
const PC_TOKEN = process.env.PRICECHARTING_TOKEN;

async function pricechartingCsv(): Promise<string> {
  if (!PC_TOKEN) throw new Error("PRICECHARTING_TOKEN not set");
  const url = `https://www.pricecharting.com/price-guide/download-custom?t=${encodeURIComponent(PC_TOKEN)}&category=pokemon-cards`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PriceCharting CSV ${res.status}`);
  return res.text();
}

/** Split one CSV line into id / console / product / price-cents. */
function splitRow(line: string): { console: string; product: string; cents: number | null } | null {
  const first = line.indexOf(",");
  if (first < 0) return null;
  const consoleName = line.slice(first + 1, line.indexOf(",", first + 1));
  const cStart = first + 1 + consoleName.length + 1;
  const last = line.lastIndexOf(",");
  const product = line.slice(cStart, last);
  const priceStr = line.slice(last + 1).trim();
  const dollars = priceStr.startsWith("$") ? Number(priceStr.slice(1).replace(/,/g, "")) : NaN;
  return {
    console: consoleName,
    product,
    cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : null,
  };
}

/** "Charizard ex [Master Ball] #205" -> { number:"205", bracket:true }. Null if no number. */
function parseCard(product: string): { number: string; bracket: boolean } | null {
  const m = product.match(/#\s*([A-Za-z0-9]+)\s*$/);
  if (!m) return null; // sealed product (Booster Box …) — no number
  return { number: m[1]!.replace(/^0+(?=\d)/, ""), bracket: /\[[^\]]+\]/.test(product) };
}

/** Best PriceCharting price per card number for one console: prefer the base (no
 * bracket) print; fall back to the cheapest bracketed variant when only those
 * exist (≈ the base card). */
function pricesByNumber(csv: string, consoleName: string): Map<string, number> {
  const base = new Map<string, number>();
  const bracketed = new Map<string, number>();
  for (const line of csv.split("\n")) {
    if (!line.includes(consoleName)) continue;
    const row = splitRow(line);
    if (!row || row.console !== consoleName || row.cents === null) continue;
    const c = parseCard(row.product);
    if (!c) continue;
    if (c.bracket) {
      const prev = bracketed.get(c.number);
      if (prev === undefined || row.cents < prev) bracketed.set(c.number, row.cents);
    } else {
      // A set can list the same number twice (rare) — keep the higher (holo).
      const prev = base.get(c.number);
      if (prev === undefined || row.cents > prev) base.set(c.number, row.cents);
    }
  }
  for (const [num, cents] of bracketed) if (!base.has(num)) base.set(num, cents);
  return base;
}

async function fetchRarity(tcgdexId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(tcgdexId)}`, {
      headers: { "User-Agent": "TCGROI/1.0" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rarity?: string | null };
    return j.rarity ?? null;
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

async function main() {
  const db = getDb();
  const [pokemon] = await db.select().from(games).where(eq(games.slug, "pokemon"));
  if (!pokemon) throw new Error("pokemon game not seeded");

  const csv = await pricechartingCsv();
  const unmapped = new Map<string, number>();
  let totalPriced = 0;
  let totalRar = 0;

  for (const [code, consoleSuffix] of Object.entries(SET_MAP)) {
    const consoleName = PC_CONSOLE_PREFIX + consoleSuffix;
    const [setRow] = await db
      .select({ id: sets.id, name: sets.name })
      .from(sets)
      .where(and(eq(sets.gameId, pokemon.id), eq(sets.code, code), eq(sets.language, "JP")));
    if (!setRow) {
      console.warn(`  ${code}: not in DB (run build-japanese-pokemon-catalog first) — skipped`);
      continue;
    }
    const cardRows = await db
      .select({ id: cards.id, number: cards.number, externalIds: cards.externalIds })
      .from(cards)
      .where(eq(cards.setId, setRow.id));

    // --- rarities (TCGdex, concurrent) ---
    const rarities = await mapLimit(cardRows, 16, async (c) => {
      const tid = (c.externalIds as { tcgdex?: string } | null)?.tcgdex;
      const raw = tid ? await fetchRarity(tid) : null;
      return { id: c.id, raw };
    });
    let setRar = 0;
    for (const r of rarities) {
      if (!r.raw) continue;
      const norm = normalizePokemonRarity(r.raw);
      if (!norm) {
        unmapped.set(r.raw, (unmapped.get(r.raw) ?? 0) + 1);
        continue;
      }
      await db.update(cards).set({ rarity: norm, updatedAt: new Date() }).where(eq(cards.id, r.id));
      setRar++;
    }
    totalRar += setRar;

    // --- prices (PriceCharting, by number) ---
    const priceMap = pricesByNumber(csv, consoleName);
    const capturedAt = new Date();
    const priceRows = cardRows
      .map((c) => ({ cardId: c.id, cents: priceMap.get(String(c.number).replace(/^0+(?=\d)/, "")) }))
      .filter((r): r is { cardId: string; cents: number } => typeof r.cents === "number");
    if (priceRows.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < priceRows.length; i += CHUNK) {
        await db
          .insert(latestPrices)
          .values(
            priceRows.slice(i, i + CHUNK).map((r) => ({
              cardId: r.cardId,
              sourceId: "pricecharting_ebay",
              priceCents: r.cents,
              kind: "raw" as const,
              capturedAt,
            })),
          )
          .onConflictDoUpdate({
            target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
            targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
            set: { priceCents: sql`excluded.price_cents`, capturedAt, updatedAt: new Date() },
          });
      }
    }
    totalPriced += priceRows.length;

    // --- inferred chase tier (TCGdex lacks JP secret rarities) ---
    // The secret/chase range comes back rarity 'unknown' from TCGdex, so group
    // the priced holos by value: $5-100 -> ultra_rare (the EV chase pool), and
    // the SAR/UR ultra-chases > $100 -> ultra_rare + display_only (shown in the
    // gallery, kept OUT of EV so a flat rate can't over-value them). Same stance
    // as the Chinese gem-pack model. Reset-then-tag keeps re-runs idempotent.
    // Reset the previously-inferred tier first (TCGdex gives JP no real
    // ultra_rare, so every ultra_rare here is one we inferred — safe to clear).
    await db.execute(sql`
      update cards set rarity = 'unknown', display_only = false
      where set_id = ${setRow.id} and rarity = 'ultra_rare'`);
    await db.execute(sql`
      update cards set rarity = 'ultra_rare', display_only = false
      where set_id = ${setRow.id} and rarity = 'unknown'
        and exists (select 1 from latest_prices lp
          where lp.card_id = cards.id and lp.kind = 'raw' and lp.price_cents between 500 and 10000)`);
    await db.execute(sql`
      update cards set rarity = 'ultra_rare', display_only = true
      where set_id = ${setRow.id} and rarity = 'unknown'
        and exists (select 1 from latest_prices lp
          where lp.card_id = cards.id and lp.kind = 'raw' and lp.price_cents > 10000)`);

    console.log(
      `  ${code} (${setRow.name}): ${setRar}/${cardRows.length} rarities, ${priceRows.length}/${cardRows.length} priced (console "${consoleName}", ${priceMap.size} PC rows).`,
    );
  }

  if (unmapped.size > 0) {
    console.log("\nUNMAPPED TCGdex rarities (add to POKEMON_RARITY_MAP):");
    for (const [k, v] of [...unmapped].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× "${k}"`);
  }
  console.log(`\nDone: ${totalRar} rarities set, ${totalPriced} cards priced across ${Object.keys(SET_MAP).length} JP sets.`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error("build-japanese-pokemon-roi failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
