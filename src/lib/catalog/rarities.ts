/**
 * Rarity vocabularies, ordered least -> most rare.
 *
 * Rarity vocab is per game and lives in data, not code branches: adding Magic
 * later means adding an entry here plus its pull-rate files, nothing else.
 * The EV engine never hardcodes a rarity name — it iterates whatever tiers a
 * set's pull-rate table declares.
 *
 * These slugs are the join key between three independent things:
 *   1. cards.rarity (written by the catalog adapters)
 *   2. pull_rate_tables.slots[].rarity (written by hand in /data/pullrates)
 *   3. the EV engine's per-tier aggregation
 * A typo in any one of them silently drops a tier's value from EV, so the
 * seed script validates (2) and (3) against this list rather than trusting it.
 */

export const POKEMON_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "double_rare", // ex cards — the "two black stars" tier
  "ace_spec_rare",
  "illustration_rare", // full-art character illustration
  "ultra_rare", // full-art ex / Supporter
  "special_illustration_rare",
  "hyper_rare", // gold
] as const;

export const ONE_PIECE_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "super_rare",
  "leader",
  "alt_art", // parallel / alternate-art treatment
  /**
   * Wanted Poster is its own tier, not a flavour of alt_art. Verified against
   * live OP-09 data: where a card has both printings, the Wanted Poster runs
   * ~10x the Alternate Art (Shanks $258 vs $27; Teach $256 vs $33). Averaging
   * them into one tier would badly misstate both.
   */
  "wanted_poster",
  "secret_rare",
  "manga_rare",
  "special", // SP cards
] as const;

/** Reserved for the documented "add a game" path; unused until MTG lands. */
export const MTG_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "mythic",
] as const;

export type PokemonRarity = (typeof POKEMON_RARITIES)[number];
export type OnePieceRarity = (typeof ONE_PIECE_RARITIES)[number];

export type KnownGameSlug = "pokemon" | "one-piece" | "mtg";

export const RARITY_VOCAB: Record<KnownGameSlug, readonly string[]> = {
  pokemon: POKEMON_RARITIES,
  "one-piece": ONE_PIECE_RARITIES,
  mtg: MTG_RARITIES,
};

/** Human-facing labels. Anything absent falls back to a title-cased slug. */
export const RARITY_LABELS: Record<string, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  double_rare: "Double Rare",
  ace_spec_rare: "ACE SPEC Rare",
  illustration_rare: "Illustration Rare",
  ultra_rare: "Ultra Rare",
  special_illustration_rare: "Special Illustration Rare",
  hyper_rare: "Hyper Rare",
  super_rare: "Super Rare",
  leader: "Leader",
  alt_art: "Alternate Art",
  wanted_poster: "Wanted Poster",
  secret_rare: "Secret Rare",
  manga_rare: "Manga Rare",
  special: "Special (SP)",
  mythic: "Mythic Rare",
};

export function rarityLabel(slug: string): string {
  return (
    RARITY_LABELS[slug] ??
    slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * True when `rarity` is a known tier for `gameSlug`. Used by the seed script
 * to reject a pull-rate file that names a tier the game does not have.
 */
export function isKnownRarity(gameSlug: string, rarity: string): boolean {
  const vocab = RARITY_VOCAB[gameSlug as KnownGameSlug] as
    | readonly string[]
    | undefined;
  return vocab?.includes(rarity) ?? false;
}
