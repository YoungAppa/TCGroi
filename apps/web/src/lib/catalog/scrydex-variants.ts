/**
 * Scrydex One Piece variant taxonomy → our (treatment, rarity) vocabulary.
 *
 * Shared by the Scrydex CATALOG adapter (which turns each variant into a card
 * row) and the Scrydex PRICE provider (which attaches each variant's price to
 * the matching row). Keeping the map in one place is what makes the two
 * self-consistent — a card labelled "manga" always gets the mangaAltArt price,
 * with no cross-source name-guessing.
 *
 * Verified live 2026-07-22 by sweeping OP-01 + OP-09 (see probe scripts).
 */

/** Scrydex rarity_code → the base card's rarity. */
export const SCRYDEX_RARITY_CODE: Record<string, string> = {
  C: "common",
  UC: "uncommon",
  R: "rare",
  SR: "super_rare",
  SEC: "secret_rare",
  L: "leader",
  TR: "treasure_rare",
};

/**
 * The base printing's variant, in preference order. A card has "normal" (C, UC,
 * R, L) OR is foil-native and has only "foil" (SR, SEC, TR). Rares carry BOTH a
 * normal and a foil; the normal is the base and the foil parallel isn't a
 * distinct pack tier, so "normal" winning here is deliberate.
 */
export const SCRYDEX_BASE_VARIANTS = ["normal", "foil"] as const;

/**
 * Non-base variants that ARE standard booster-pack tiers → (treatment, rarity).
 * Everything absent here is a promo or special release, NOT a pack pull, and is
 * skipped so it can't pollute a tier average or masquerade as a chase card:
 *   - stamps (championship/winner/topPlayer/regional/anniversary/…)
 *   - special releases (premium/gold/silver special, best-selection, gift,
 *     promotion, event, convention, tournament, film, anniversary/edition alts)
 *   - reprints, jollyRoger/textured/serialized foils, starter-deck cards
 *   - nonTexturedMangaAltArt (a secondary manga printing; the primary
 *     mangaAltArt is the one modelled in the pull tables' single manga slot)
 */
export const SCRYDEX_TREATMENT_VARIANTS: Record<
  string,
  { treatment: string; rarity: string }
> = {
  altArt: { treatment: "alt_art", rarity: "alt_art" },
  mangaAltArt: { treatment: "manga", rarity: "manga_rare" },
  wantedPoster: { treatment: "wanted_poster", rarity: "wanted_poster" },
  specialAltArt: { treatment: "sp", rarity: "special" },
  treasureRare: { treatment: "treasure", rarity: "treasure_rare" },
};

/** The base rarity for a Scrydex rarity_code, or null if we don't model it. */
export function scrydexBaseRarity(rarityCode: string | null | undefined): string | null {
  if (!rarityCode) return null;
  return SCRYDEX_RARITY_CODE[rarityCode.toUpperCase()] ?? null;
}
