/**
 * Seeds static reference data: games (with their rarity vocabularies) and the
 * price_sources registry.
 *
 * Idempotent — safe to re-run on every deploy. Catalog data (sets/cards) is
 * ingested by the refresh-catalog job, and pull-rate tables are loaded from
 * /data/pullrates by their own loader; neither belongs here.
 *
 *   npm run db:seed
 */
import { getDb, games, priceSources } from "@/lib/db";
import { RARITY_VOCAB } from "@/lib/catalog/rarities";
import { ALL_PRICE_SOURCES } from "@/lib/prices/sources";

const GAMES: { slug: "pokemon" | "one-piece"; displayName: string }[] = [
  { slug: "pokemon", displayName: "Pokémon TCG" },
  { slug: "one-piece", displayName: "One Piece TCG" },
  // Magic lands here when its catalog adapter + pull-rate files exist. The
  // schema, EV engine, and UI need no change for it.
];

async function main() {
  const db = getDb();

  for (const g of GAMES) {
    await db
      .insert(games)
      .values({
        slug: g.slug,
        displayName: g.displayName,
        rarityVocab: [...RARITY_VOCAB[g.slug]],
      })
      .onConflictDoUpdate({
        target: games.slug,
        set: {
          displayName: g.displayName,
          // Re-seeding picks up vocab edits; cards referencing a removed tier
          // would be orphaned, so vocab is append-mostly in practice.
          rarityVocab: [...RARITY_VOCAB[g.slug]],
        },
      });
    console.log(`  game: ${g.slug} (${RARITY_VOCAB[g.slug].length} rarities)`);
  }

  for (const s of ALL_PRICE_SOURCES) {
    await db
      .insert(priceSources)
      .values({ id: s.id, displayName: s.displayName, attribution: s.attribution })
      .onConflictDoUpdate({
        target: priceSources.id,
        set: { displayName: s.displayName, attribution: s.attribution },
      });
    console.log(`  price source: ${s.id}`);
  }

  console.log("\nSeed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
