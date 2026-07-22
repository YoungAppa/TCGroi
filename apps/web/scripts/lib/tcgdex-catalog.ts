/**
 * Shared TCGdex catalog ingest for the non-English Pokémon inventories (JP, ZH).
 * TCGdex returns a whole set's cards in one set-detail call, so there is no
 * pagination — the only cost that matters is the DB write, which we batch
 * (bulk upsert in chunks) rather than one round-trip per card.
 *
 * Deliberately price-less: TCGdex carries no prices and these markets have no
 * free price feed yet, so rows are searchable/holdable but unvalued. Each
 * language is its own keyspace (sets unique index is gameId+code+language), so
 * this never collides with the English rows or the other language.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, sets } from "@/lib/db";

const REQUEST_GAP_MS = 60;

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
    .array(
      z.object({
        id: z.string(),
        localId: z.union([z.string(), z.number()]),
        name: z.string(),
        image: z.string().nullish(),
      }),
    )
    .nullish(),
});
type TcgdexCard = NonNullable<z.infer<typeof setDetail>["cards"]>[number];

/** TCGdex serves a base asset path; the real file needs a quality + format suffix. */
function cardImage(base: string | null | undefined): string | null {
  return base ? `${base}/high.webp` : null;
}

/** Bulk-upsert one set's cards (no prices), deduped by number, in chunks. */
async function writeCards(
  db: ReturnType<typeof getDb>,
  setId: string,
  list: TcgdexCard[],
): Promise<number> {
  const byNumber = new Map<string, TcgdexCard>();
  for (const c of list) byNumber.set(String(c.localId), c); // last wins; numbers are unique per set
  const rows = [...byNumber.values()];
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(cards)
      .values(
        chunk.map((c) => ({
          setId,
          name: c.name,
          number: String(c.localId),
          rarity: "unknown",
          treatment: "base",
          imageUrl: cardImage(c.image),
          externalIds: { tcgdex: c.id },
        })),
      )
      .onConflictDoUpdate({
        target: [cards.setId, cards.number, cards.treatment],
        set: {
          name: sql`excluded.name`,
          imageUrl: sql`excluded.image_url`,
          externalIds: sql`${cards.externalIds} || excluded.external_ids`,
          updatedAt: new Date(),
        },
      });
  }
  return rows.length;
}

export async function ingestTcgdexCatalog(opts: {
  /** TCGdex language path, e.g. "ja" or "zh-cn". */
  lang: string;
  /** Our set_language enum value for this language. */
  language: "JP" | "ZH";
  /** Human label for logs, e.g. "Japanese". */
  label: string;
  limit?: number;
}): Promise<void> {
  const db = getDb();
  const [pokemon] = await db.select().from(games).where(eq(games.slug, "pokemon"));
  if (!pokemon) throw new Error("pokemon game not seeded");

  const base = `https://api.tcgdex.net/v2/${opts.lang}`;
  const allSets = await fetchJson(`${base}/sets`, setsResponse, { provider: "tcgdex", retries: 3 });
  const todo = allSets.slice(0, opts.limit);
  console.log(`${allSets.length} ${opts.label} Pokémon sets on TCGdex; ingesting ${todo.length}.`);

  let setsDone = 0;
  let cardsStored = 0;

  for (const s of todo) {
    try {
      const detail = await fetchJson(`${base}/sets/${encodeURIComponent(s.id)}`, setDetail, {
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
          language: opts.language,
          // TCGdex logo assets take a bare extension; most non-EN sets have none.
          logoUrl: detail.logo ? `${detail.logo}.png` : null,
          externalIds: { tcgdex: detail.id },
        })
        .onConflictDoUpdate({
          target: [sets.gameId, sets.code, sets.language],
          set: { name: detail.name, updatedAt: new Date() },
        })
        .returning({ id: sets.id });

      cardsStored += await writeCards(db, setRow!.id, detail.cards ?? []);
      setsDone++;
      if (setsDone % 20 === 0) {
        console.log(`  [${setsDone}/${todo.length}] ${detail.id} ${detail.name}`);
      }
    } catch (err) {
      console.warn(`  ${s.id} ${s.name}: ${err instanceof Error ? err.message : String(err)} — skipped`);
    }
    await sleep(REQUEST_GAP_MS);
  }

  console.log(`\nDone: ${setsDone} ${opts.label} sets, ${cardsStored} cards stored (no prices — catalog only).`);
}
