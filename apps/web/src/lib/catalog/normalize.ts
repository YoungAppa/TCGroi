/**
 * Maps raw catalog-provider fields onto our rarity vocabulary and treatments.
 *
 * This module is pure and heavily tested because a mapping miss is silent: an
 * unrecognised rarity does not throw, it just produces a card that no
 * pull-rate tier claims, and its value vanishes from EV with no error.
 */
import { isKnownRarity } from "./rarities";

export interface NormalizedCard {
  rarity: string;
  treatment: string;
  /** Card name with any treatment suffix stripped. */
  name: string;
}

// ---------------------------------------------------------------------------
// Pokémon
// ---------------------------------------------------------------------------

/**
 * pokemontcg.io rarity strings -> our slugs. Verified against the live API:
 * Surging Sparks (sv8) returns exactly these nine values.
 */
const POKEMON_RARITY_MAP: Record<string, string> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  "double rare": "double_rare",
  "ace spec rare": "ace_spec_rare",
  "illustration rare": "illustration_rare",
  "ultra rare": "ultra_rare",
  "special illustration rare": "special_illustration_rare",
  "hyper rare": "hyper_rare",
  // Mega Evolution era's gold chase rarity (me1+), its own tier.
  "mega hyper rare": "mega_hyper_rare",
  // Black Bolt / White Flare chase rarity (Zekrom ex / Reshiram ex / Victini).
  "black white rare": "black_white_rare",
  // Shiny tiers, live in Paldean Fates (sv4pt5). Their own tiers — see the note
  // in POKEMON_RARITIES. Distinct from the legacy "rare shiny" string below,
  // which older sets used for a single ultra-tier shiny and which stays mapped
  // to ultra_rare.
  "shiny rare": "shiny_rare",
  "shiny ultra rare": "shiny_ultra_rare",
  // Older-era rarities, for sets we may ingest later. Mapped to the nearest
  // modern tier so they land somewhere sensible rather than vanishing.
  "rare holo": "rare",
  "rare holo ex": "ultra_rare",
  "rare holo gx": "ultra_rare",
  "rare holo v": "double_rare",
  "rare holo vmax": "ultra_rare",
  "rare holo vstar": "ultra_rare",
  "rare ultra": "ultra_rare",
  "rare secret": "hyper_rare",
  "rare rainbow": "hyper_rare",
  "rare shiny": "ultra_rare",
  "amazing rare": "ultra_rare",
  "radiant rare": "double_rare",
  "trainer gallery rare holo": "illustration_rare",
  // Own tier, never in a pull-rate slot — see the note in POKEMON_RARITIES.
  promo: "promo",
};

export function normalizePokemonRarity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return POKEMON_RARITY_MAP[raw.trim().toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// One Piece
// ---------------------------------------------------------------------------

/**
 * optcgapi reports base rarity codes only. The treatment that actually drives
 * price and odds — Manga, Alternate Art, SP — is encoded in the *card name*
 * suffix instead, e.g. "Gol.D.Roger (Manga)" is reported as rarity "SEC".
 *
 * Concretely, in OP-09: base SEC Gol.D.Roger is $36, the Alternate Art is
 * $100, and the Manga is $5,500 — a 150x spread the rarity field cannot see.
 * Collapsing those into one "secret_rare" tier would average a $5,500 chase
 * card together with a $36 bulk SEC and make One Piece EV meaningless.
 *
 * So the treatment suffix is promoted to a first-class rarity tier, which is
 * what the One Piece vocab (alt_art / manga_rare / special) already expects.
 */
const ONE_PIECE_BASE_RARITY_MAP: Record<string, string> = {
  c: "common",
  uc: "uncommon",
  r: "rare",
  sr: "super_rare",
  l: "leader",
  sec: "secret_rare",
  p: "common", // promo
  sp: "special",
  "sp card": "special",
  tr: "treasure_rare", // live OP-06 data: "Nami (TR)" carries rarity code TR
};

/**
 * Treatment suffixes seen in optcgapi card_name values, longest-first so that
 * a more specific match wins.
 */
/**
 * A treatment parenthetical is usually terminal — "Gol.D.Roger (Manga)" — but
 * OP-05 style names put a numeric disambiguator after it:
 * "Trafalgar Law (Alternate Art) (069)". So each pattern matches its
 * parenthetical when followed only by an optional "(digits)" tail, and
 * stripping it preserves that tail: the (069) is part of the card's name.
 */
function treatmentPattern(label: string): RegExp {
  return new RegExp(`\\s*\\(${label}\\)(?=(?:\\s*\\(\\d+\\))?\\s*$)`, "i");
}

const ONE_PIECE_TREATMENTS: { suffix: RegExp; treatment: string; rarity: string | null }[] = [
  { suffix: treatmentPattern("manga"), treatment: "manga", rarity: "manga_rare" },
  /**
   * Wanted Poster must stay distinct from Alternate Art in BOTH fields.
   *
   * Mapping them to the same treatment collapses their identity — a card with
   * both printings (OP09-004 Shanks, OP09-093 Teach, OP09-051 Buggy in OP-09
   * alone) loses one of them to the dedupe. Mapping them to the same rarity
   * averages a ~$258 chase card against a ~$27 one.
   */
  { suffix: treatmentPattern("wanted poster"), treatment: "wanted_poster", rarity: "wanted_poster" },
  // One per booster box (OP-01 era). Found by the ingest failing loudly on
  // OP-01 — exactly the failure mode the collision check exists to catch.
  { suffix: treatmentPattern("box topper"), treatment: "box_topper", rarity: "box_topper" },
  { suffix: treatmentPattern("alternate art"), treatment: "alt_art", rarity: "alt_art" },
  { suffix: treatmentPattern("alt art"), treatment: "alt_art", rarity: "alt_art" },
  { suffix: treatmentPattern("parallel"), treatment: "parallel", rarity: "alt_art" },
  // SP is a treatment AND its own rarity tier.
  { suffix: treatmentPattern("sp"), treatment: "sp", rarity: "special" },
  // Treasure Rare, likewise (live OP-06: "Nami (TR)").
  { suffix: treatmentPattern("tr"), treatment: "treasure", rarity: "treasure_rare" },
];

/**
 * Derives rarity + treatment + clean name for a One Piece card.
 *
 * `rawRarity` is optcgapi's rarity code (C/UC/R/SR/L/SEC); `rawName` may carry
 * a treatment suffix that overrides it.
 */
/**
 * Some optcgapi names carry a trailing set annotation after the treatment,
 * e.g. "Jack (Parallel) - Two Legends (OP08)" (live OP-08 data). It is
 * display noise, not identity — the set is already known from context — and
 * it hides the treatment from the terminal-position matchers, so it is
 * stripped first. The pattern is deliberately narrow: " - <text> (<set code>)"
 * at end of string only.
 */
const SET_ANNOTATION = /\s+-\s+[^()]+\(\s*(?:OP|EB|ST)-?\d+\s*\)\s*$/i;

export function normalizeOnePieceCard(
  rawName: string,
  rawRarity: string | null | undefined,
): NormalizedCard | null {
  const baseRarity = rawRarity
    ? (ONE_PIECE_BASE_RARITY_MAP[rawRarity.trim().toLowerCase()] ?? null)
    : null;

  rawName = rawName.replace(SET_ANNOTATION, "").trim();

  for (const t of ONE_PIECE_TREATMENTS) {
    if (t.suffix.test(rawName)) {
      return {
        // The treatment's tier wins: a Manga SEC belongs with manga rares, not
        // with base SECs.
        rarity: t.rarity ?? baseRarity ?? "rare",
        treatment: t.treatment,
        name: rawName.replace(t.suffix, "").trim(),
      };
    }
  }

  if (!baseRarity) return null;
  return { rarity: baseRarity, treatment: "base", name: rawName.trim() };
}

/** Guard used by the ingest job before writing a card. */
export function assertKnownRarity(gameSlug: string, rarity: string): void {
  if (!isKnownRarity(gameSlug, rarity)) {
    throw new Error(
      `Rarity "${rarity}" is not in the ${gameSlug} vocabulary. Add it to RARITY_VOCAB or fix the mapping — an unknown rarity silently drops out of EV.`,
    );
  }
}
