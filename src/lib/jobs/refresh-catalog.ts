import { and, eq, ne, sql } from "drizzle-orm";

import { OptcgApiAdapter } from "@/lib/catalog/providers/optcgapi";
import { PokemonTcgIoAdapter } from "@/lib/catalog/providers/pokemontcgio";
import type { CatalogAdapter, CatalogSet } from "@/lib/catalog/types";
import { cards, games, getDb, pullRateTables, sets } from "@/lib/db";
import { loadAllPullRates } from "@/lib/pullrates/load";

import { runJob } from "./run";

/**
 * refresh-catalog: sets + cards from the catalog adapters into the DB, then
 * pull-rate files into pull_rate_tables.
 *
 * Idempotent: everything is an upsert keyed on the natural identity —
 * (game, code, language) for sets, (set, number, treatment) for cards,
 * (set, version) for pull-rate tables. Run it twice, get the same DB.
 *
 * Scope: Pokémon ingests only sets that have a pull-rate file (a set without
 * one can't rank, and pokemontcg.io has 173 sets we'd burn quota on); One
 * Piece ingests everything its adapter enumerates, because the set list is
 * short and OP sets cross-reference cards from earlier sets.
 */
export async function refreshCatalog() {
  return runJob("refresh-catalog", async () => {
    const db = getDb();
    const loaded = await loadAllPullRates();

    const gameRows = await db.select().from(games);
    const gameIdBySlug = new Map(gameRows.map((g) => [g.slug, g.id]));

    const adapters: CatalogAdapter[] = [new PokemonTcgIoAdapter(), new OptcgApiAdapter()];

    let setsUpserted = 0;
    let cardsUpserted = 0;

    for (const adapter of adapters) {
      const gameId = gameIdBySlug.get(adapter.gameSlug);
      if (!gameId) throw new Error(`game ${adapter.gameSlug} not seeded`);

      const wantedCodes =
        adapter.gameSlug === "pokemon"
          ? new Set(
              loaded.filter((l) => l.file.game === "pokemon").map((l) => l.file.setCode),
            )
          : null; // null = all

      const allSets = await adapter.fetchSets();
      const targetSets = allSets.filter((s) => !wantedCodes || wantedCodes.has(s.code));

      for (const cs of targetSets) {
        const setId = await upsertSet(gameId, cs);
        setsUpserted++;

        const fetched = await adapter.fetchCards(cs);
        for (const c of fetched) {
          await db
            .insert(cards)
            .values({
              setId,
              name: c.name,
              number: c.number,
              rarity: c.rarity,
              treatment: c.treatment,
              imageUrl: c.imageUrl,
              externalIds: c.externalIds,
            })
            .onConflictDoUpdate({
              target: [cards.setId, cards.number, cards.treatment],
              set: {
                name: c.name,
                rarity: c.rarity,
                imageUrl: c.imageUrl,
                // merge, not replace: another provider's ids must survive
                externalIds: sql`${cards.externalIds} || ${JSON.stringify(c.externalIds)}::jsonb`,
                updatedAt: new Date(),
              },
            });
          cardsUpserted++;
        }
      }
    }

    // --- pull-rate files -> pull_rate_tables ---------------------------------
    let tablesLoaded = 0;
    for (const { file } of loaded) {
      const gameId = gameIdBySlug.get(file.game);
      if (!gameId) continue;

      const [setRow] = await getDb()
        .select({ id: sets.id })
        .from(sets)
        .where(and(eq(sets.gameId, gameId), eq(sets.code, file.setCode)));
      if (!setRow) continue; // set not ingested (e.g. placeholder for a future set)

      await db
        .insert(pullRateTables)
        .values({
          setId: setRow.id,
          version: file.version,
          // DB column is NOT NULL; 0 encodes "undisclosed or placeholder" and
          // the file's null/0 distinction is preserved in confidence + note.
          sampleSizePacks: file.sampleSizePacks ?? 0,
          sourceUrl: file.sourceUrl,
          sourceNote: file.sourceNote,
          confidence: file.confidence,
          slots: file.slots,
          guaranteedSlots: file.guaranteedSlots,
          showWhenPlaceholder: file.showWhenPlaceholder,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [pullRateTables.setId, pullRateTables.version],
          set: {
            sampleSizePacks: file.sampleSizePacks ?? 0,
            sourceUrl: file.sourceUrl,
            sourceNote: file.sourceNote,
            confidence: file.confidence,
            slots: file.slots,
            guaranteedSlots: file.guaranteedSlots,
            showWhenPlaceholder: file.showWhenPlaceholder,
            isActive: true,
          },
        });

      // Exactly one active version per set.
      await db
        .update(pullRateTables)
        .set({ isActive: false })
        .where(
          and(eq(pullRateTables.setId, setRow.id), ne(pullRateTables.version, file.version)),
        );
      tablesLoaded++;
    }

    return { setsUpserted, cardsUpserted, tablesLoaded };
  });
}

async function upsertSet(gameId: string, cs: CatalogSet): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(sets)
    .values({
      gameId,
      code: cs.code,
      name: cs.name,
      releaseDate: cs.releaseDate,
      language: cs.language,
      externalIds: cs.externalIds,
    })
    .onConflictDoUpdate({
      target: [sets.gameId, sets.code, sets.language],
      set: {
        name: cs.name,
        releaseDate: cs.releaseDate,
        externalIds: sql`${sets.externalIds} || ${JSON.stringify(cs.externalIds)}::jsonb`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: sets.id });

  if (!row) throw new Error(`upsert returned no row for set ${cs.code}`);
  return row.id;
}
