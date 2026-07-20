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
  /**
   * Promo cards (svp Black Star Promos etc.). Deliberately its own tier and
   * deliberately never listed in any pull-rate table's slots: promos enter EV
   * only as a product's guaranteed extras, and bucketing them into "rare"
   * would corrupt that tier's average when promo cards are appended to a
   * product's card list.
   */
  "promo",
  "common",
  "uncommon",
  "rare",
  "double_rare", // ex cards — the "two black stars" tier
  "ace_spec_rare",
  "illustration_rare", // full-art character illustration
  "ultra_rare", // full-art ex / Supporter
  "special_illustration_rare",
  "hyper_rare", // gold
  /**
   * Mega Evolution era (me1+, 2025) replaced Hyper Rare with Mega Hyper Rare —
   * a gold four-pointed-star rarity that is drastically scarcer (~1 in 1,260
   * packs vs ~1 in 140 for the old Hyper Rare), so it is its own tier.
   */
  "mega_hyper_rare",
  /**
   * Shiny tiers, reintroduced in the special set Paldean Fates (sv4pt5) after
   * Hidden/Shining Fates. Their own tiers, not folded into ultra/special: a
   * Shiny Rare is a common-value baby shiny (120 of them, ~$1 each) while a
   * Shiny Ultra Rare is a full-art shiny ex chase — averaging them together,
   * or into the normal ex tiers, would badly misstate both. Only special sets
   * carry them; a pull-rate file names them only when the set actually has them.
   */
  "shiny_rare",
  "shiny_ultra_rare",
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
  /**
   * Box-topper printings (OP-01 era): one guaranteed per booster box, drawn
   * from a small pool. A distinct printing with its own price, and its
   * one-per-box nature makes it a boxGuarantee in pull-rate files, never a
   * random per-pack slot.
   */
  "box_topper",
  /** Treasure Rare — EB-line chase treatment inserted into some sets. */
  "treasure_rare",
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
  promo: "Promo",
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  double_rare: "Double Rare",
  ace_spec_rare: "ACE SPEC Rare",
  illustration_rare: "Illustration Rare",
  ultra_rare: "Ultra Rare",
  special_illustration_rare: "Special Illustration Rare",
  hyper_rare: "Hyper Rare",
  mega_hyper_rare: "Mega Hyper Rare",
  shiny_rare: "Shiny Rare",
  shiny_ultra_rare: "Shiny Ultra Rare",
  super_rare: "Super Rare",
  leader: "Leader",
  alt_art: "Alternate Art",
  wanted_poster: "Wanted Poster",
  box_topper: "Box Topper",
  treasure_rare: "Treasure Rare",
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
