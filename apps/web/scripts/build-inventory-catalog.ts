/**
 * Build the inventory card database: every Pokémon set's cards worth > $1, with
 * images and a live price — the searchable catalog a user's collection tracker
 * adds cards from. Separate from the RANKING catalog (refresh-catalog), which
 * only ingests sets that have pull-rate data.
 *
 * Differences from refresh-catalog on purpose:
 *   - ALL pokemontcg.io sets, not just ranked ones.
 *   - Raw rarity stored as-is (no EV-tier normalisation — old sets carry
 *     rarities the tier map doesn't know, and inventory cards never enter EV).
 *   - Cards under the price floor are skipped, so the index stays lean.
 *   - Price comes inline from pokemontcg.io (tcgplayer market), written straight
 *     to latest_prices — no separate refresh-prices pass.
 *
 * Idempotent: re-run to refresh. Ranked sets (already ingested with normalised
 * rarities) are skipped so this never fights refresh-catalog over a row.
 *
 *   npx tsx --env-file=.env.local scripts/build-inventory-catalog.ts
 *   npx tsx --env-file=.env.local scripts/build-inventory-catalog.ts --floor 100   # cents
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const BASE = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 250;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function headers(): Record<string, string> {
  const key = process.env.POKEMONTCG_IO_KEY;
  return key ? { "X-Api-Key": key } : {};
}

const setSchema = z.object({
  id: z.string(),
  name: z.string(),
  releaseDate: z.string().nullish(),
  total: z.number().nullish(),
  images: z.object({ logo: z.string().nullish() }).nullish(),
});
const setsResponse = z.object({ data: z.array(setSchema) });

const priceLeg = z.object({ market: z.number().nullish(), mid: z.number().nullish() }).passthrough();
const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.string(),
  rarity: z.string().nullish(),
  images: z.object({ small: z.string().nullish(), large: z.string().nullish() }).nullish(),
  tcgplayer: z
    .object({ prices: z.record(z.string(), priceLeg).nullish() })
    .passthrough()
    .nullish(),
});
const cardsResponse = z.object({
  data: z.array(cardSchema),
  page: z.number(),
  pageSize: z.number(),
  totalCount: z.number(),
});

/** Highest tcgplayer market (or mid) across a card's price variants, in cents. */
function bestPriceCents(c: z.infer<typeof cardSchema>): number | null {
  const legs = Object.values(c.tcgplayer?.prices ?? {});
  let best = 0;
  for (const l of legs) {
    const v = l.market ?? l.mid;
    if (typeof v === "number" && v > best) best = v;
  }
  return best > 0 ? Math.round(best * 100) : null;
}

async function main() {
  const db = getDb();
  const floorCents = Number(arg("--floor") ?? "100"); // $1
  const [pokemon] = await db.select().from(games).where(eq(games.slug, "pokemon"));
  if (!pokemon) throw new Error("pokemon game not seeded");

  // Sets we already ingested for ranking — skip, they're handled with proper
  // rarities by refresh-catalog and priced by refresh-prices.
  const ranked = new Set(
    (await db.select({ code: sets.code }).from(sets).where(eq(sets.gameId, pokemon.id))).map(
      (r) => r.code,
    ),
  );

  const allSets = (
    await fetchJson(`${BASE}/sets?orderBy=-releaseDate&pageSize=${PAGE_SIZE}`, setsResponse, {
      provider: "pokemontcg_io",
      headers: headers(),
      treat404AsTransient: true,
      retries: 4,
    })
  ).data;

  const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
  const todo = allSets.filter((s) => !ranked.has(s.id)).slice(0, limit);
  console.log(
    `${allSets.length} Pokémon sets; ${ranked.size} already ranked; ` +
      `ingesting ${todo.length} new sets, cards ≥ $${(floorCents / 100).toFixed(2)}.`,
  );

  let setsDone = 0;
  let cardsStored = 0;
  const capturedAt = new Date();

  for (const s of todo) {
    let setId: string;
    try {
      const [row] = await db
        .insert(sets)
        .values({
          gameId: pokemon.id,
          code: s.id,
          name: s.name,
          releaseDate: s.releaseDate ? s.releaseDate.replace(/\//g, "-") : null,
          language: "EN",
          logoUrl: s.images?.logo ?? null,
          externalIds: { pokemontcg_io: s.id },
        })
        .onConflictDoUpdate({
          target: [sets.gameId, sets.code, sets.language],
          set: { name: s.name, updatedAt: new Date() },
        })
        .returning({ id: sets.id });
      setId = row!.id;

      let setCards = 0;
      for (let page = 1; ; page++) {
        const q = encodeURIComponent(`set.id:${s.id}`);
        const res = await fetchJson(
          `${BASE}/cards?q=${q}&page=${page}&pageSize=${PAGE_SIZE}&select=id,name,number,rarity,images,tcgplayer`,
          cardsResponse,
          { provider: "pokemontcg_io", headers: headers(), treat404AsTransient: true, retries: 4 },
        );

        for (const c of res.data) {
          const cents = bestPriceCents(c);
          if (cents === null || cents < floorCents) continue; // bulk / unpriced → skip

          const [cardRow] = await db
            .insert(cards)
            .values({
              setId,
              name: c.name,
              number: c.number,
              rarity: c.rarity ?? "unknown",
              treatment: "base",
              imageUrl: c.images?.large ?? c.images?.small ?? null,
              externalIds: { pokemontcg_io: c.id },
            })
            .onConflictDoUpdate({
              target: [cards.setId, cards.number, cards.treatment],
              set: {
                name: c.name,
                rarity: c.rarity ?? "unknown",
                imageUrl: c.images?.large ?? c.images?.small ?? null,
                externalIds: sql`${cards.externalIds} || ${JSON.stringify({ pokemontcg_io: c.id })}::jsonb`,
                updatedAt: new Date(),
              },
            })
            .returning({ id: cards.id });

          await db
            .insert(latestPrices)
            .values({
              cardId: cardRow!.id,
              sourceId: "tcgplayer_market",
              priceCents: cents,
              kind: "raw",
              capturedAt,
            })
            .onConflictDoUpdate({
              // Partial unique index (cardId,sourceId,kind) WHERE cardId NOT NULL.
              target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
              targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
              set: { priceCents: cents, capturedAt, updatedAt: new Date() },
            });
          setCards++;
          cardsStored++;
        }
        if (res.page * res.pageSize >= res.totalCount || res.data.length === 0) break;
      }
      setsDone++;
      if (setsDone % 10 === 0 || setCards > 50) {
        console.log(`  [${setsDone}/${todo.length}] ${s.id} ${s.name}: ${setCards} cards ≥ floor`);
      }
    } catch (err) {
      console.warn(`  ${s.id} ${s.name}: ${err instanceof Error ? err.message : String(err)} — skipped`);
    }
  }

  console.log(`\nDone: ${setsDone} sets ingested, ${cardsStored} cards ≥ $${(floorCents / 100).toFixed(2)} stored with prices.`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("inventory build failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
