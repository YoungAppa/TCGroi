/**
 * Extend the One Piece inventory DB with the SUPPLEMENTARY Scrydex expansions —
 * Extra Boosters (EB), Premium Boosters (PRB), Starter decks (ST), and promos —
 * that the ranking catalog deliberately leaves out (it only ingests the numbered
 * OP-01..OP-16 main sets, which have pull-rate data). Those extra sets still hold
 * cards people own and want to track, so they belong in the searchable
 * collection catalog like every other inventory build.
 *
 * DB-only: cards > $1 with an image and best raw price, base treatment, raw
 * Scrydex rarity code. Idempotent. Uses the same Scrydex creds as the ranking
 * pipeline (TCGPLAYER_MIRROR_API_KEY + SCRYDEX_TEAM_ID).
 *
 *   npx tsx --env-file=.env.local scripts/build-one-piece-inventory.ts
 *   npx tsx --env-file=.env.local scripts/build-one-piece-inventory.ts --floor 100
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";
import { getEnv } from "@/lib/env";

const BASE = "https://api.scrydex.com";
const PAGE_SIZE = 100;
// Scrydex ids of the ranked main sets — skip these, they're handled by the
// ranking catalog with normalised rarities + pull rates.
const RANKED = new Set(Array.from({ length: 16 }, (_, i) => `OP${String(i + 1).padStart(2, "0")}`));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const imageSchema = z.object({ large: z.string().nullish(), medium: z.string().nullish() }).passthrough();
const priceEntry = z.object({ type: z.string().nullish(), market: z.number().nullish(), low: z.number().nullish() }).passthrough();
const variantSchema = z.object({ name: z.string().nullish(), images: z.array(imageSchema).nullish(), prices: z.array(priceEntry).nullish() }).passthrough();
const cardSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  number: z.string().nullish(),
  rarity_code: z.string().nullish(),
  images: z.array(imageSchema).nullish(),
  variants: z.array(variantSchema).nullish(),
}).passthrough();
const cardsResponse = z.object({ data: z.array(cardSchema).nullish(), total_count: z.number().nullish() }).passthrough();
const expansionSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  code: z.string().nullish(),
  release_date: z.string().nullish(),
  logo: z.string().nullish(),
  language_code: z.string().nullish(),
}).passthrough();
const expansionsResponse = z.object({ data: z.array(expansionSchema).nullish(), total_count: z.number().nullish() }).passthrough();

function firstImage(imgs: z.infer<typeof imageSchema>[] | null | undefined): string | null {
  const i = imgs?.[0];
  return i?.large ?? i?.medium ?? null;
}
/** Highest raw market price across a card's variants, in cents. */
function bestRawCents(c: z.infer<typeof cardSchema>): number | null {
  let best = 0;
  for (const v of c.variants ?? []) {
    for (const p of v.prices ?? []) {
      if (p.type === "raw") {
        const val = p.market ?? p.low;
        if (typeof val === "number" && val > best) best = val;
      }
    }
  }
  return best > 0 ? Math.round(best * 100) : null;
}
/** Card art from the card or its first variant. */
function cardImage(c: z.infer<typeof cardSchema>): string | null {
  return firstImage(c.images) ?? firstImage(c.variants?.[0]?.images);
}
/** "EB01" -> "EB-01", "PRB01" -> "PRB-01", "ST01" -> "ST-01". */
function normalizeCode(id: string): string {
  return id.replace(/^([A-Za-z]+)(\d.*)$/, "$1-$2");
}

interface Row {
  name: string;
  number: string;
  rarity: string;
  image: string | null;
  scrydexId: string;
  cents: number;
}

async function main() {
  const env = getEnv();
  const key = env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = env.SCRYDEX_TEAM_ID;
  if (!key || !teamId) throw new Error("Scrydex creds missing (TCGPLAYER_MIRROR_API_KEY + SCRYDEX_TEAM_ID)");
  const headers = { "X-Api-Key": key, "X-Team-ID": teamId };

  const db = getDb();
  const floorCents = Number(arg("--floor") ?? "100");
  const [op] = await db.select().from(games).where(eq(games.slug, "one-piece"));
  if (!op) throw new Error("one-piece game not seeded");

  // All EN expansions, minus the ranked main sets.
  const expansions: z.infer<typeof expansionSchema>[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchJson(
      `${BASE}/onepiece/v1/expansions?page=${page}&page_size=${PAGE_SIZE}`,
      expansionsResponse,
      { provider: "scrydex", headers, retries: 3 },
    );
    const batch = res.data ?? [];
    expansions.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const todo = expansions.filter(
    (e) => (e.language_code ?? "EN").toUpperCase() === "EN" && !RANKED.has(e.id.toUpperCase()),
  );
  console.log(
    `${expansions.length} OP expansions; ingesting ${todo.length} supplementary EN sets (EB/PRB/ST/promo), cards ≥ $${(floorCents / 100).toFixed(2)}.`,
  );

  let setsDone = 0;
  let cardsStored = 0;
  const capturedAt = new Date();

  for (const e of todo) {
    try {
      const code = normalizeCode(e.id);
      const [setRow] = await db
        .insert(sets)
        .values({
          gameId: op.id,
          code,
          name: e.name ?? code,
          releaseDate: e.release_date ?? null,
          language: "EN",
          logoUrl: e.logo ?? null,
          externalIds: { scrydex: e.id },
        })
        .onConflictDoUpdate({
          target: [sets.gameId, sets.code, sets.language],
          set: { name: e.name ?? code, updatedAt: new Date() },
        })
        .returning({ id: sets.id });
      const setId = setRow!.id;

      // Collect priced cards across pages.
      const byNumber = new Map<string, Row>();
      for (let page = 1; ; page++) {
        const res = await fetchJson(
          `${BASE}/onepiece/v1/expansions/${encodeURIComponent(e.id)}/cards?include=prices&page=${page}&page_size=${PAGE_SIZE}`,
          cardsResponse,
          { provider: "scrydex", headers, retries: 3 },
        );
        const batch = res.data ?? [];
        for (const c of batch) {
          const cents = bestRawCents(c);
          if (cents === null || cents < floorCents) continue;
          const number = c.number ?? c.id;
          const ex = byNumber.get(number);
          if (!ex || cents > ex.cents) {
            byNumber.set(number, {
              name: c.name ?? "Unknown",
              number,
              rarity: c.rarity_code ?? "unknown",
              image: cardImage(c),
              scrydexId: c.id,
              cents,
            });
          }
        }
        if (batch.length < PAGE_SIZE) break;
      }

      const rows = [...byNumber.values()];
      if (rows.length > 0) {
        const inserted = await db
          .insert(cards)
          .values(
            rows.map((r) => ({
              setId,
              name: r.name,
              number: r.number,
              rarity: r.rarity,
              treatment: "base",
              imageUrl: r.image,
              externalIds: { scrydex: r.scrydexId },
            })),
          )
          .onConflictDoUpdate({
            target: [cards.setId, cards.number, cards.treatment],
            set: {
              name: sql`excluded.name`,
              rarity: sql`excluded.rarity`,
              imageUrl: sql`excluded.image_url`,
              externalIds: sql`${cards.externalIds} || excluded.external_ids`,
              updatedAt: new Date(),
            },
          })
          .returning({ id: cards.id, number: cards.number });

        const idByNumber = new Map(inserted.map((r) => [r.number, r.id]));
        const priceRows = rows
          .map((r) => ({ cardId: idByNumber.get(r.number), cents: r.cents }))
          .filter((r): r is { cardId: string; cents: number } => typeof r.cardId === "string");
        if (priceRows.length > 0) {
          await db
            .insert(latestPrices)
            .values(
              priceRows.map((r) => ({
                cardId: r.cardId,
                sourceId: "tcgplayer_market",
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

      cardsStored += rows.length;
      setsDone++;
      console.log(`  ${normalizeCode(e.id)} ${e.name ?? ""}: ${rows.length} cards ≥ floor`);
    } catch (err) {
      console.warn(`  ${e.id} ${e.name ?? ""}: ${err instanceof Error ? err.message : String(err)} — skipped`);
    }
  }

  console.log(`\nDone: ${setsDone} supplementary OP sets, ${cardsStored} cards ≥ $${(floorCents / 100).toFixed(2)} stored.`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("one piece inventory build failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
