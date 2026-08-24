/**
 * Fill in cards missing from ranked English sets, using Scrydex.
 *
 * The English Pokémon catalog was built from pokemontcg.io, which turned out to
 * be incomplete for older sets: 1,960 cards were missing across 47 ranked sets,
 * with Sun & Moon base carrying 43 of its 173. Scrydex, now the licensed paid
 * source, has the full lists.
 *
 * What this changes and what it does not: the gaps are overwhelmingly
 * Common/Uncommon/Rare, which never appear in a pull-rate slot and are valued
 * as bulk, so EV barely moves. What it fixes is the CATALOG — set galleries,
 * collection search, and the handful of genuinely missing hits (Sun & Moon was
 * short one Rare Holo GX, Roaring Skies one Rare Ultra) which do enter EV.
 *
 * Existing rows are left alone apart from filling a missing image: this is a
 * top-up, not a re-ingest, so a card whose rarity was deliberately corrected
 * (the WOTC holo tagging, for one) is not silently reverted.
 *
 * Usage: tsx --env-file=.env.local scripts/topup-english-cards.ts [setCode]
 */
import { and, eq, sql } from "drizzle-orm";

import { normalizePokemonRarity } from "@/lib/catalog/normalize";
import {
  cards,
  games,
  getDb,
  latestPrices,
  priceSnapshots,
  pullRateTables,
  sets,
} from "@/lib/db";

const BASE = "https://api.scrydex.com";
const PAGE_SIZE = 100;
const CONDITION_ORDER = ["NM", "LP", "MP", "HP", "DM", "U"];

/** USD raw price in dollars. Currency filter matters — see the JP ingest. */
function rawDollars(prices: Record<string, unknown>[] | undefined): number | null {
  if (!prices?.length) return null;
  const raws = prices.filter(
    (p) =>
      String(p.type ?? "raw").toLowerCase() === "raw" &&
      String(p.currency ?? "USD").toUpperCase() === "USD",
  );
  for (const cond of CONDITION_ORDER) {
    const e = raws.find((p) => p.condition === cond);
    const v = (e?.market ?? e?.low ?? e?.mid) as number | undefined;
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
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

async function main() {
  const key = process.env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = process.env.SCRYDEX_TEAM_ID;
  if (!key || !teamId) {
    console.error("Need TCGPLAYER_MIRROR_API_KEY + SCRYDEX_TEAM_ID.");
    process.exit(1);
  }
  const headers = { "X-Api-Key": key, "X-Team-ID": teamId, accept: "application/json" };
  const only = process.argv[2]?.toLowerCase();

  const db = getDb();
  const [game] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  if (!game) throw new Error("pokemon game row missing");

  const setRows = await db
    .select({ id: sets.id, code: sets.code, name: sets.name, externalIds: sets.externalIds })
    .from(sets)
    .innerJoin(pullRateTables, and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)))
    .where(and(eq(sets.gameId, game.id), eq(sets.language, "EN")));

  const targets = setRows.filter((s) => !only || s.code.toLowerCase() === only);
  console.log(`Topping up ${targets.length} ranked English sets\n`);

  let added = 0;
  let priced = 0;
  let hitsAdded = 0;
  const unmapped = new Set<string>();
  const failures: string[] = [];

  for (const s of targets) {
    // pokemontcg.io ids are Scrydex ids for Pokémon (verified) — fall back to
    // the bare set code for anything ingested without one.
    const expansionId = s.externalIds["pokemontcg_io"] ?? s.code;
    let rows: {
      id: string;
      name?: string;
      number?: string;
      rarity?: string;
      images?: { type?: string; large?: string; medium?: string }[];
      variants?: { prices?: Record<string, unknown>[] }[];
    }[];
    try {
      const acc: typeof rows = [];
      for (let page = 1; ; page++) {
        const b = await getJson(
          `${BASE}/pokemon/v1/expansions/${encodeURIComponent(expansionId)}/cards?include=prices&page=${page}&page_size=${PAGE_SIZE}`,
          headers,
        );
        const got = b.data ?? [];
        acc.push(...got);
        if (!got.length || page * (b.page_size ?? PAGE_SIZE) >= (b.total_count ?? 0)) break;
      }
      rows = acc;
    } catch (err) {
      failures.push(`${s.code}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!rows.length) continue;

    const have = new Set(
      (
        await db
          .select({ number: cards.number })
          .from(cards)
          .where(and(eq(cards.setId, s.id), eq(cards.treatment, "base")))
      ).map((c) => c.number),
    );

    const toInsert: {
      setId: string;
      number: string;
      name: string;
      rarity: string;
      treatment: string;
      imageUrl: string | null;
      externalIds: Record<string, string>;
    }[] = [];
    const priceByNumber = new Map<string, number>();

    for (const c of rows) {
      const number = String(c.number ?? "").trim();
      if (!number || have.has(number)) continue;

      const rarity = normalizePokemonRarity(c.rarity ?? null);
      if (!rarity) {
        unmapped.add(c.rarity ?? "(null)");
        continue;
      }
      const img = c.images?.find((x) => x.type === "front") ?? c.images?.[0];
      toInsert.push({
        setId: s.id,
        number,
        name: c.name ?? c.id,
        rarity,
        treatment: "base",
        imageUrl: img?.large ?? img?.medium ?? null,
        externalIds: { pokemontcg_io: c.id, scrydex: c.id },
      });
      if (!["common", "uncommon", "rare"].includes(rarity)) hitsAdded++;

      let dollars: number | null = null;
      for (const v of c.variants ?? []) {
        dollars = rawDollars(v.prices);
        if (dollars !== null) break;
      }
      if (dollars !== null) priceByNumber.set(number, Math.round(dollars * 100));
    }

    if (!toInsert.length) continue;

    for (let i = 0; i < toInsert.length; i += 500) {
      await db
        .insert(cards)
        .values(toInsert.slice(i, i + 500))
        // Only ever fill a gap. An existing row keeps its rarity, which may have
        // been corrected on purpose.
        .onConflictDoNothing({ target: [cards.setId, cards.number, cards.treatment] });
    }
    added += toInsert.length;

    const written = await db
      .select({ id: cards.id, number: cards.number })
      .from(cards)
      .where(and(eq(cards.setId, s.id), eq(cards.treatment, "base")));
    const priceRows = written.flatMap((w) => {
      const cents = priceByNumber.get(w.number);
      return cents === undefined
        ? []
        : [{
            cardId: w.id,
            sourceId: "tcgplayer_market",
            priceCents: cents,
            kind: "raw" as const,
            capturedAt: new Date(),
          }];
    });
    for (let i = 0; i < priceRows.length; i += 500) {
      const chunk = priceRows.slice(i, i + 500);
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
    priced += priceRows.length;
    console.log(`  ${s.code.padEnd(9)} +${String(toInsert.length).padStart(4)} cards  ${s.name}`);
  }

  console.log(`\nDone. ${added} cards added (${hitsAdded} above bulk rarity), ${priced} prices written.`);
  if (unmapped.size) {
    console.log(
      `Unmapped rarities skipped (add to POKEMON_RARITY_MAP if they should count): ${[...unmapped].join(", ")}`,
    );
  }
  for (const f of failures) console.log(`  FAILED ${f}`);
  process.exit(0);
}

main();
