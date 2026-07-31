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
import { RARITY_VOCAB, type KnownGameSlug } from "@/lib/catalog/rarities";
import { ALL_PRICE_SOURCES } from "@/lib/prices/sources";

const GAMES: { slug: KnownGameSlug; displayName: string }[] = [
  { slug: "pokemon", displayName: "Pokémon TCG" },
  { slug: "one-piece", displayName: "One Piece TCG" },
  // Magic is searchable inventory today (Scryfall catalog + prices, built by
  // scripts/build-magic-catalog.ts). Pull-rate files can land later to give it
  // EV/ranking; the schema, EV engine, and UI need no change for either.
  { slug: "mtg", displayName: "Magic: The Gathering" },
  // Counter-Strike 2 weapon cases: official Valve drop odds (HIGH confidence),
  // catalog from bymykel/CSGO-API, prices from Skinport. Cases are "case" sealed
  // products; one open = one item, cost = case price + a $2.50 key.
  { slug: "counter-strike-2", displayName: "Counter-Strike 2" },
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
