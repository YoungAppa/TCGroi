/**
 * Build the Magic: The Gathering inventory card database from Scryfall — every
 * paper card worth > $1, with an image and a live price, so a user's collection
 * tracker can search and hold MTG cards alongside Pokémon and One Piece.
 *
 * Scryfall is the definitive free MTG catalog (name, set, collector number,
 * rarity, images) AND carries TCGplayer-derived USD prices (`prices.usd` /
 * `prices.usd_foil`), so one source covers catalog + price. We store the higher
 * of the normal/foil price and reuse the `tcgplayer_market` price source, since
 * that is where Scryfall's USD comes from.
 *
 * Like build-inventory-catalog (Pokémon), this is DB-only — no EV/ranking.
 * Rarity is stored raw. Cards under the floor are skipped so the index stays
 * lean. Idempotent: re-run to refresh.
 *
 *   npx tsx --env-file=.env.local scripts/build-magic-catalog.ts
 *   npx tsx --env-file=.env.local scripts/build-magic-catalog.ts --floor 100   # cents
 *   npx tsx --env-file=.env.local scripts/build-magic-catalog.ts --limit 20    # first N sets
 */
import { sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { MTG_RARITIES } from "@/lib/catalog/rarities";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const BASE = "https://api.scryfall.com";
// Scryfall asks for ~50-100ms between requests; be a good citizen.
const REQUEST_GAP_MS = 90;
// Scryfall requires a User-Agent (and Accept, which fetchJson already sends);
// requests without one are rejected with HTTP 400.
const SCRYFALL_HEADERS = { "User-Agent": "TCGROI/1.0 (collection inventory build)" };
// Set types that are not real collectible paper cards.
const SKIP_SET_TYPES = new Set(["token", "memorabilia", "minigame", "vanguard"]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const setSchema = z.object({
  code: z.string(),
  name: z.string(),
  set_type: z.string(),
  released_at: z.string().nullish(),
  card_count: z.number().nullish(),
  digital: z.boolean().nullish(),
  icon_svg_uri: z.string().nullish(),
});
const setsResponse = z.object({ data: z.array(setSchema) });

const imageUris = z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough();
const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  collector_number: z.string(),
  rarity: z.string(),
  image_uris: imageUris.nullish(),
  card_faces: z
    .array(z.object({ image_uris: imageUris.nullish() }).passthrough())
    .nullish(),
  prices: z
    .object({ usd: z.string().nullish(), usd_foil: z.string().nullish(), usd_etched: z.string().nullish() })
    .passthrough()
    .nullish(),
});
const cardsResponse = z.object({
  data: z.array(cardSchema),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});

/** Highest of a card's USD prices (normal/foil/etched), in cents. */
function bestPriceCents(c: z.infer<typeof cardSchema>): number | null {
  let best = 0;
  for (const raw of [c.prices?.usd, c.prices?.usd_foil, c.prices?.usd_etched]) {
    const v = raw ? Number(raw) : NaN;
    if (Number.isFinite(v) && v > best) best = v;
  }
  return best > 0 ? Math.round(best * 100) : null;
}

/** Card art, handling double-faced cards (no top-level image_uris). */
function cardImage(c: z.infer<typeof cardSchema>): string | null {
  const top = c.image_uris?.large ?? c.image_uris?.normal;
  if (top) return top;
  const face = c.card_faces?.[0]?.image_uris;
  return face?.large ?? face?.normal ?? null;
}

async function getMagicGameId(db: ReturnType<typeof getDb>): Promise<string> {
  const [row] = await db
    .insert(games)
    .values({ slug: "mtg", displayName: "Magic: The Gathering", rarityVocab: [...MTG_RARITIES] })
    .onConflictDoUpdate({
      target: games.slug,
      set: { displayName: "Magic: The Gathering", rarityVocab: [...MTG_RARITIES] },
    })
    .returning({ id: games.id });
  return row!.id;
}

async function main() {
  const db = getDb();
  const floorCents = Number(arg("--floor") ?? "100"); // $1
  const gameId = await getMagicGameId(db);

  const allSets = (await fetchJson(`${BASE}/sets`, setsResponse, { provider: "scryfall", headers: SCRYFALL_HEADERS, retries: 3 })).data;
  const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
  const todo = allSets
    .filter((s) => !s.digital && !SKIP_SET_TYPES.has(s.set_type) && (s.card_count ?? 0) > 0)
    // Newest first so a partial run still gets the cards people are most likely to hold.
    .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""))
    .slice(0, limit);

  console.log(
    `${allSets.length} Scryfall sets; ingesting ${todo.length} paper sets, cards ≥ $${(floorCents / 100).toFixed(2)}.`,
  );

  let setsDone = 0;
  let cardsStored = 0;
  const capturedAt = new Date();

  for (const s of todo) {
    try {
      const [setRow] = await db
        .insert(sets)
        .values({
          gameId,
          code: s.code,
          name: s.name,
          releaseDate: s.released_at ?? null,
          language: "EN",
          logoUrl: s.icon_svg_uri ?? null,
          externalIds: { scryfall: s.code },
        })
        .onConflictDoUpdate({
          target: [sets.gameId, sets.code, sets.language],
          set: { name: s.name, updatedAt: new Date() },
        })
        .returning({ id: sets.id });
      const setId = setRow!.id;

      let setCards = 0;
      // Every print (variant) of the set. We must page through all of them, not
      // stop early on price: `order=usd` sorts by the NON-foil price, so a
      // foil-only chase card (null usd, high usd_foil) sorts to the very bottom.
      // The floor is applied per card on max(usd, foil, etched) instead.
      let url: string | null =
        `${BASE}/cards/search?q=${encodeURIComponent(`e:${s.code} game:paper`)}&unique=prints&order=set`;
      while (url) {
        let res: z.infer<typeof cardsResponse>;
        try {
          res = await fetchJson(url, cardsResponse, { provider: "scryfall", headers: SCRYFALL_HEADERS, retries: 3 });
        } catch (err) {
          // A set with no paper cards returns 404 from the search endpoint.
          if (err instanceof Error && /HTTP 404/.test(err.message)) break;
          throw err;
        }

        for (const c of res.data) {
          const cents = bestPriceCents(c);
          if (cents === null || cents < floorCents) continue; // bulk / unpriced → skip
          const img = cardImage(c);
          const [cardRow] = await db
            .insert(cards)
            .values({
              setId,
              name: c.name,
              number: c.collector_number,
              rarity: c.rarity,
              treatment: "base",
              imageUrl: img,
              externalIds: { scryfall: c.id },
            })
            .onConflictDoUpdate({
              target: [cards.setId, cards.number, cards.treatment],
              set: {
                name: c.name,
                rarity: c.rarity,
                imageUrl: img,
                externalIds: sql`${cards.externalIds} || ${JSON.stringify({ scryfall: c.id })}::jsonb`,
                updatedAt: new Date(),
              },
            })
            .returning({ id: cards.id });

          await db
            .insert(latestPrices)
            .values({ cardId: cardRow!.id, sourceId: "tcgplayer_market", priceCents: cents, kind: "raw", capturedAt })
            .onConflictDoUpdate({
              target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
              targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
              set: { priceCents: cents, capturedAt, updatedAt: new Date() },
            });
          setCards++;
          cardsStored++;
        }
        url = res.has_more ? (res.next_page ?? null) : null;
        if (url) await sleep(REQUEST_GAP_MS);
      }

      setsDone++;
      if (setsDone % 25 === 0 || setCards > 40) {
        console.log(`  [${setsDone}/${todo.length}] ${s.code} ${s.name}: ${setCards} cards ≥ floor`);
      }
    } catch (err) {
      console.warn(`  ${s.code} ${s.name}: ${err instanceof Error ? err.message : String(err)} — skipped`);
    }
    await sleep(REQUEST_GAP_MS);
  }

  console.log(
    `\nDone: ${setsDone} sets ingested, ${cardsStored} cards ≥ $${(floorCents / 100).toFixed(2)} stored with prices.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("magic build failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
