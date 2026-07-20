import { describe, expect, it } from "vitest";

import {
  assertKnownRarity,
  normalizeOnePieceCard,
  normalizePokemonRarity,
} from "./normalize";
import { POKEMON_RARITIES, ONE_PIECE_RARITIES } from "./rarities";

describe("normalizePokemonRarity", () => {
  // These nine strings are exactly what the live pokemontcg.io API returns for
  // Surging Sparks (sv8). If this list drifts, ingest silently loses a tier.
  const LIVE_SV8_RARITIES = [
    "Common",
    "Uncommon",
    "Rare",
    "Double Rare",
    "ACE SPEC Rare",
    "Illustration Rare",
    "Ultra Rare",
    "Special Illustration Rare",
    "Hyper Rare",
  ];

  it("maps every rarity the live Surging Sparks response contains", () => {
    for (const raw of LIVE_SV8_RARITIES) {
      expect(normalizePokemonRarity(raw), `unmapped: ${raw}`).not.toBeNull();
    }
  });

  it("only ever produces slugs that exist in the Pokémon vocabulary", () => {
    for (const raw of LIVE_SV8_RARITIES) {
      expect(POKEMON_RARITIES).toContain(normalizePokemonRarity(raw)!);
    }
  });

  it("maps the headline tiers correctly", () => {
    expect(normalizePokemonRarity("Special Illustration Rare")).toBe(
      "special_illustration_rare",
    );
    expect(normalizePokemonRarity("Hyper Rare")).toBe("hyper_rare");
    expect(normalizePokemonRarity("Double Rare")).toBe("double_rare");
    expect(normalizePokemonRarity("ACE SPEC Rare")).toBe("ace_spec_rare");
  });

  it("maps Paldean Fates shiny tiers to their own slugs", () => {
    // Distinct tiers: a Shiny Rare is a ~$1 baby shiny, a Shiny Ultra Rare a
    // full-art shiny ex chase. Neither folds into the ultra/special tiers.
    expect(normalizePokemonRarity("Shiny Rare")).toBe("shiny_rare");
    expect(normalizePokemonRarity("Shiny Ultra Rare")).toBe("shiny_ultra_rare");
    // The legacy single-shiny string stays on the old mapping.
    expect(normalizePokemonRarity("Rare Shiny")).toBe("ultra_rare");
  });

  it("maps the Mega Evolution-era Mega Hyper Rare to its own tier", () => {
    expect(normalizePokemonRarity("Mega Hyper Rare")).toBe("mega_hyper_rare");
    // The old Hyper Rare is unaffected.
    expect(normalizePokemonRarity("Hyper Rare")).toBe("hyper_rare");
  });

  it("maps the Black Bolt / White Flare Black White Rare to its own tier", () => {
    expect(normalizePokemonRarity("Black White Rare")).toBe("black_white_rare");
  });

  it("maps the Ascended Heroes Mega Attack Rare from both string forms", () => {
    // pokemontcg.io emits the unusual underscore form for this set; accept the
    // space-cased form too in case that is normalised upstream later.
    expect(normalizePokemonRarity("MEGA_ATTACK_RARE")).toBe("mega_attack_rare");
    expect(normalizePokemonRarity("Mega Attack Rare")).toBe("mega_attack_rare");
    // It is its own tier, not folded into Ultra Rare.
    expect(normalizePokemonRarity("Ultra Rare")).toBe("ultra_rare");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizePokemonRarity("  hYpEr RaRe  ")).toBe("hyper_rare");
  });

  it("returns null for an unknown rarity rather than guessing", () => {
    // Null is a signal the ingest job turns into a visible error. Guessing a
    // tier would put a card's price in the wrong bucket.
    expect(normalizePokemonRarity("Cosmic Ultra Mega Rare")).toBeNull();
  });

  it("returns null for missing input", () => {
    expect(normalizePokemonRarity(null)).toBeNull();
    expect(normalizePokemonRarity(undefined)).toBeNull();
    expect(normalizePokemonRarity("")).toBeNull();
  });
});

describe("normalizeOnePieceCard", () => {
  // Verbatim from the live optcgapi OP-09 response.
  it("keeps a base Secret Rare in the secret_rare tier", () => {
    expect(normalizeOnePieceCard("Gol.D.Roger", "SEC")).toEqual({
      rarity: "secret_rare",
      treatment: "base",
      name: "Gol.D.Roger",
    });
  });

  it("promotes a Manga printing to its own tier despite the SEC rarity code", () => {
    // The $5,500 card. optcgapi calls it "SEC", same as the $36 base — the
    // whole reason this function exists.
    expect(normalizeOnePieceCard("Gol.D.Roger (Manga)", "SEC")).toEqual({
      rarity: "manga_rare",
      treatment: "manga",
      name: "Gol.D.Roger",
    });
  });

  it("promotes a Manga printing that the API reports as SR", () => {
    // "Shanks (004) (Manga)" = $2,028, reported as rarity SR.
    expect(normalizeOnePieceCard("Shanks (004) (Manga)", "SR")).toEqual({
      rarity: "manga_rare",
      treatment: "manga",
      name: "Shanks (004)",
    });
  });

  it("separates Alternate Art from base", () => {
    expect(normalizeOnePieceCard("Gol.D.Roger (Alternate Art)", "SEC")).toEqual({
      rarity: "alt_art",
      treatment: "alt_art",
      name: "Gol.D.Roger",
    });
  });

  it("keeps Wanted Poster distinct from Alternate Art", () => {
    // Regression: both once mapped to treatment "alt_art", which collided on
    // (number, treatment) and silently dropped three of OP-09's priciest
    // cards. Live prices: Shanks Wanted Poster $258 vs Alternate Art $27.
    const wanted = normalizeOnePieceCard("Shanks (004) (Wanted Poster)", "SR")!;
    const alt = normalizeOnePieceCard("Shanks (004) (Alternate Art)", "SR")!;

    expect(wanted.treatment).not.toBe(alt.treatment);
    expect(wanted.rarity).not.toBe(alt.rarity);
    expect(wanted).toEqual({
      rarity: "wanted_poster",
      treatment: "wanted_poster",
      name: "Shanks (004)",
    });
  });

  it("gives every OP-09 treatment of one number a unique identity", () => {
    // The exact set of printings OP09-004 has in the live data.
    const printings = [
      "Shanks (004)",
      "Shanks (004) (Alternate Art)",
      "Shanks (004) (Wanted Poster)",
      "Shanks (004) (Manga)",
      "Shanks (004) (Parallel)",
    ].map((n) => normalizeOnePieceCard(n, "SR")!);

    const identities = printings.map((p) => p.treatment);
    expect(new Set(identities).size).toBe(printings.length);
  });

  it("separates Box Topper printings", () => {
    // Regression: OP-01 ingest failed loudly on six unmapped "(Box Topper)"
    // cards — real printings, one guaranteed per box, distinct prices.
    expect(normalizeOnePieceCard("Perona (Box Topper)", "R")).toEqual({
      rarity: "box_topper",
      treatment: "box_topper",
      name: "Perona",
    });
  });

  it("handles a treatment followed by a numeric disambiguator", () => {
    // Regression from live OP-05: "Trafalgar Law (Alternate Art) (069)" — the
    // treatment is not terminal; the (069) is part of the card's name and must
    // survive the strip.
    expect(normalizeOnePieceCard("Trafalgar Law (Alternate Art) (069)", "SR")).toEqual({
      rarity: "alt_art",
      treatment: "alt_art",
      name: "Trafalgar Law (069)",
    });
  });

  it("does not treat an embedded word as a treatment unless positioned as one", () => {
    // "(SP)" mid-name with trailing text is not a treatment suffix.
    expect(normalizeOnePieceCard("Weird (SP) Name", "R")).toEqual({
      rarity: "rare",
      treatment: "base",
      name: "Weird (SP) Name",
    });
  });

  it("classifies Treasure Rare via code or suffix", () => {
    // Live OP-06: "Nami (TR)" with rarity code "TR".
    expect(normalizeOnePieceCard("Nami (TR)", "TR")).toEqual({
      rarity: "treasure_rare",
      treatment: "treasure",
      name: "Nami",
    });
    // Code alone, no suffix.
    expect(normalizeOnePieceCard("Nami", "TR")!.rarity).toBe("treasure_rare");
  });

  it("strips a trailing set annotation before treatment matching", () => {
    // Live OP-08: "Jack (Parallel) - Two Legends (OP08)".
    expect(normalizeOnePieceCard("Jack (Parallel) - Two Legends (OP08)", "SR")).toEqual({
      rarity: "alt_art",
      treatment: "parallel",
      name: "Jack",
    });
  });

  it("separates SP printings", () => {
    expect(normalizeOnePieceCard("Nami (SP)", "SR")).toEqual({
      rarity: "special",
      treatment: "sp",
      name: "Nami",
    });
  });

  it("gives the three printings of OP09-118 three distinct tiers and treatments", () => {
    // The concrete bug this prevents: one collector number, three cards,
    // $36 / $100 / $5,500. Averaging them into one tier is meaningless.
    const base = normalizeOnePieceCard("Gol.D.Roger", "SEC")!;
    const alt = normalizeOnePieceCard("Gol.D.Roger (Alternate Art)", "SEC")!;
    const manga = normalizeOnePieceCard("Gol.D.Roger (Manga)", "SEC")!;

    expect(new Set([base.rarity, alt.rarity, manga.rarity]).size).toBe(3);
    expect(new Set([base.treatment, alt.treatment, manga.treatment]).size).toBe(3);
  });

  it("maps the plain rarity codes", () => {
    expect(normalizeOnePieceCard("X", "C")!.rarity).toBe("common");
    expect(normalizeOnePieceCard("X", "UC")!.rarity).toBe("uncommon");
    expect(normalizeOnePieceCard("X", "R")!.rarity).toBe("rare");
    expect(normalizeOnePieceCard("X", "SR")!.rarity).toBe("super_rare");
    expect(normalizeOnePieceCard("X", "L")!.rarity).toBe("leader");
  });

  it("only ever produces slugs in the One Piece vocabulary", () => {
    const samples: [string, string][] = [
      ["Gol.D.Roger", "SEC"],
      ["Gol.D.Roger (Manga)", "SEC"],
      ["Gol.D.Roger (Alternate Art)", "SEC"],
      ["Nami (SP)", "SR"],
      ["Buggy", "C"],
      ["Shanks", "L"],
    ];
    for (const [name, rarity] of samples) {
      const n = normalizeOnePieceCard(name, rarity)!;
      expect(ONE_PIECE_RARITIES, `${name}/${rarity}`).toContain(n.rarity);
    }
  });

  it("is case-insensitive on both the code and the suffix", () => {
    expect(normalizeOnePieceCard("Roger (MANGA)", "sec")!.rarity).toBe("manga_rare");
  });

  it("returns null for an unknown rarity code with no treatment hint", () => {
    expect(normalizeOnePieceCard("Mystery", "ZZ")).toBeNull();
  });

  it("still classifies a treated card when the rarity code is unknown", () => {
    // The suffix alone is enough to know it's a manga rare.
    expect(normalizeOnePieceCard("Mystery (Manga)", "ZZ")!.rarity).toBe("manga_rare");
  });

  it("does not strip parenthetical text that is part of the name", () => {
    // "Monkey.D.Luffy (119)" — the (119) disambiguates reprints and is NOT a
    // treatment. Stripping it would collide with another card's name.
    expect(normalizeOnePieceCard("Monkey.D.Luffy (119)", "SEC")).toEqual({
      rarity: "secret_rare",
      treatment: "base",
      name: "Monkey.D.Luffy (119)",
    });
  });
});

describe("assertKnownRarity", () => {
  it("accepts a rarity in the game's vocabulary", () => {
    expect(() => assertKnownRarity("pokemon", "hyper_rare")).not.toThrow();
    expect(() => assertKnownRarity("one-piece", "manga_rare")).not.toThrow();
  });

  it("throws on a rarity from the wrong game's vocabulary", () => {
    // manga_rare is One Piece only — this catches a cross-wired adapter.
    expect(() => assertKnownRarity("pokemon", "manga_rare")).toThrow(/vocabulary/);
  });

  it("throws on an unknown rarity", () => {
    expect(() => assertKnownRarity("pokemon", "nonsense")).toThrow(/silently drops out of EV/);
  });
});
