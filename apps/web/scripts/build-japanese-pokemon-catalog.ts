/**
 * Build the Japanese Pokémon inventory from TCGdex — every JP set and its cards,
 * with images, so JP collectors can track their cards in the collection tracker.
 *
 * DB-only and deliberately price-less: TCGdex carries no prices, and JP Pokémon
 * has no reliable free price feed we can attach yet (the ROI side stays English).
 * These rows exist to be searchable and holdable, not valued — a card with no
 * price simply shows "—" and sorts last, exactly like an unpriced EN card.
 *
 * Names are the Japanese names TCGdex ships (JP-exclusive cards have no English
 * name), so these are found by searching in Japanese. Stored under the pokemon
 * game with language = "JP", a separate keyspace from the English rows (the sets
 * unique index is gameId+code+language), so this never collides with them.
 *
 * Idempotent: re-run to refresh.
 *
 *   npx tsx --env-file=.env.local scripts/build-japanese-pokemon-catalog.ts
 *   npx tsx --env-file=.env.local scripts/build-japanese-pokemon-catalog.ts --limit 10
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, sets } from "@/lib/db";

const BASE = "https://api.tcgdex.net/v2/ja";
const REQUEST_GAP_MS = 60;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const setsResponse = z.array(
  z.object({ id: z.string(), name: z.string(), cardCount: z.object({ total: z.number() }).nullish() }),
);
const setDetail = z.object({
  id: z.string(),
  name: z.string(),
  releaseDate: z.string().nullish(),
  logo: z.string().nullish(),
  cards: z
    .array(z.object({ id: z.string(), localId: z.union([z.string(), z.number()]), name: z.string(), image: z.string().nullish() }))
    .nullish(),
});

/** TCGdex serves a base asset path; the real file needs a quality + format suffix. */
function cardImage(base: string | null | undefined): string | null {
  return base ? `${base}/high.webp` : null;
}

async function main() {
  const db = getDb();
  const [pokemon] = await db.select().from(games).where(eq(games.slug, "pokemon"));
  if (!pokemon) throw new Error("pokemon game not seeded");

  const allSets = await fetchJson(`${BASE}/sets`, setsResponse, { provider: "tcgdex", retries: 3 });
  const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
  const todo = allSets.slice(0, limit);
  console.log(`${allSets.length} Japanese Pokémon sets on TCGdex; ingesting ${todo.length}.`);

  let setsDone = 0;
  let cardsStored = 0;

  for (const s of todo) {
    try {
      const detail = await fetchJson(`${BASE}/sets/${encodeURIComponent(s.id)}`, setDetail, {
        provider: "tcgdex",
        retries: 3,
      });

      const [setRow] = await db
        .insert(sets)
        .values({
          gameId: pokemon.id,
          code: detail.id,
          name: detail.name,
          releaseDate: detail.releaseDate ?? null,
          language: "JP",
          // TCGdex logo assets take a bare extension (no quality); most JP sets
          // have none. Non-critical — the tracker shows card art, not set logos.
          logoUrl: detail.logo ? `${detail.logo}.png` : null,
          externalIds: { tcgdex: detail.id },
        })
        .onConflictDoUpdate({
          target: [sets.gameId, sets.code, sets.language],
          set: { name: detail.name, updatedAt: new Date() },
        })
        .returning({ id: sets.id });
      const setId = setRow!.id;

      for (const c of detail.cards ?? []) {
        await db
          .insert(cards)
          .values({
            setId,
            name: c.name,
            number: String(c.localId),
            rarity: "unknown",
            treatment: "base",
            imageUrl: cardImage(c.image),
            externalIds: { tcgdex: c.id },
          })
          .onConflictDoUpdate({
            target: [cards.setId, cards.number, cards.treatment],
            set: {
              name: c.name,
              imageUrl: cardImage(c.image),
              externalIds: sql`${cards.externalIds} || ${JSON.stringify({ tcgdex: c.id })}::jsonb`,
              updatedAt: new Date(),
            },
          });
        cardsStored++;
      }

      setsDone++;
      if (setsDone % 20 === 0) {
        console.log(`  [${setsDone}/${todo.length}] ${detail.id} ${detail.name}: ${detail.cards?.length ?? 0} cards`);
      }
    } catch (err) {
      console.warn(`  ${s.id} ${s.name}: ${err instanceof Error ? err.message : String(err)} — skipped`);
    }
    await sleep(REQUEST_GAP_MS);
  }

  console.log(`\nDone: ${setsDone} JP sets, ${cardsStored} cards stored (no prices — JP is non-ROI).`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("japanese pokemon build failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
