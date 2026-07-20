import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/lib/env";
import type { CatalogSet } from "@/lib/catalog/types";

import type { PriceableCard } from "../types";
import { PriceChartingAdapter } from "./pricecharting";

/**
 * These tests are the regression armor for the single most bug-prone file in
 * the repo: three real production bugs have been traced to its matching rules
 * (console keying that grabbed a $1,199 reprint for a $0.13 base card;
 * unmapped "[Alternate Art Manga]" labels that dropped every manga rare;
 * cross-set reprints filed under their origin console). Each rule below is
 * pinned to a CSV fixture so a future edit can't silently reintroduce them.
 *
 * The adapter's only I/O is `fetch` of the bulk CSV, so we stub that and drive
 * the public fetchCardPrices/fetchSealedPrices — the private index builders are
 * exercised through them, exactly as the job does.
 */

// One row per matching rule we care about. Columns: id,console-name,product-name,loose-price
const OP_CSV = [
  "id,console-name,product-name,loose-price",
  // Roronoa Zoro OP06-118 — the four printings that must stay distinct.
  "1,One Piece Wings of the Captain,Roronoa Zoro OP06-118,$8.00",
  "2,One Piece Wings of the Captain,Roronoa Zoro [Alternate Art] OP06-118,$136.43",
  "3,One Piece Wings of the Captain,Roronoa Zoro [Alternate Art Manga] OP06-118,$2741.28",
  // Unmapped promo bracket — must never enter the index.
  "4,One Piece Wings of the Captain,Roronoa Zoro [Championship 2024] OP06-118,$500.00",
  // Japanese console — a separate, unwanted printing.
  "5,One Piece Japanese Wings of the Captain,Roronoa Zoro [Alternate Art Manga] OP06-118,$1079.56",
  // Shanks OP01-120 — the OTHER manga label spelling.
  "6,One Piece Romance Dawn,Shanks [Alternate Art] OP01-120,$100.62",
  "7,One Piece Romance Dawn,Shanks [Manga Alternate Art] OP01-120,$1695.05",
  // Cross-set reprint, UNAMBIGUOUS: OP01-051 wanted only under its origin console.
  "8,One Piece Romance Dawn,Eustass Captain Kid [Wanted] OP01-051,$39.50",
  // Cross-set code that is AMBIGUOUS across two English consoles → dropped from
  // the fallback, but each console's own lookup still resolves correctly.
  "9,One Piece Pillars of Strength,Foo OP99-001,$0.50",
  "10,One Piece Reprint Collection,Foo OP99-001,$500.00",
  // Plain [Manga] and [Wanted Poster] spellings.
  "11,One Piece Carrying on His Will,Monkey.D.Luffy [Manga] OP13-118,$2078.00",
  "12,One Piece Kingdoms of Intrigue,Boa Hancock [Wanted Poster] OP04-112,$60.00",
  // Parallel (optcgapi's word for the ★ alt art) and SP.
  "13,One Piece Paramount War,Trafalgar Law [Parallel] OP02-069,$5.00",
  "14,One Piece Paramount War,Nami [SP] OP02-060,$50.00",
  // Abbreviated "[Alt Art]" (some sets) alongside a distinct "[Alt Art Errata]"
  // that must NOT be mistaken for it.
  "17,One Piece Romance Dawn,Monkey.D.Luffy [Alt Art Errata] OP01-003,$660.15",
  "18,One Piece Romance Dawn,Monkey.D.Luffy [Alt Art] OP01-003,$873.15",
  // Sealed rows (no code, no bracket).
  "15,One Piece Wings of the Captain,Booster Box,$353.95",
  "16,One Piece Wings of the Captain,Booster Pack,$6.50",
].join("\n");

const PK_CSV = [
  "id,console-name,product-name,loose-price",
  "100,Pokemon Stellar Crown,Squirtle #148,$2.00",
  // Bracketed reverse-holo re-listing — must be skipped so the base wins.
  "101,Pokemon Stellar Crown,Squirtle [Reverse Holo] #148,$3.00",
  // Product name containing a comma — splitRow must reconstruct it.
  "102,Pokemon Stellar Crown,Mr. Mime, Jr. #155,$1.25",
  // Console-override set (sv3pt5 → "Pokemon Scarlet & Violet 151").
  "103,Pokemon Scarlet & Violet 151,Charizard ex #199,$300.00",
  // Sealed: base-set box uses the alternate label.
  "104,Pokemon Scarlet & Violet,Base Set Booster Box,$500.00",
  "105,Pokemon Stellar Crown,Booster Box,$100.00",
  "106,Pokemon Stellar Crown,Elite Trainer Box,$40.00",
].join("\n");

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      const csv = u.includes("one-piece-cards")
        ? OP_CSV
        : u.includes("pokemon-cards")
          ? PK_CSV
          : "";
      return { ok: true, status: 200, text: async () => csv } as Response;
    }),
  );
}

function opSet(name: string): CatalogSet {
  return { code: name, name, releaseDate: null, language: "EN", expectedCardCount: null, externalIds: { optcgapi: name } };
}
function pkSet(code: string, name: string): CatalogSet {
  return { code, name, releaseDate: null, language: "EN", expectedCardCount: null, externalIds: { pokemontcg_io: code } };
}
function card(number: string, treatment: string): PriceableCard {
  return { cardId: `id-${number}-${treatment}`, name: number, number, rarity: "x", treatment, externalIds: { optcgapi: `${number}-${treatment}` } };
}

async function priceOne(adapter: PriceChartingAdapter, set: CatalogSet, c: PriceableCard): Promise<number | undefined> {
  const out = await adapter.fetchCardPrices(set, [c]);
  return out[0]?.priceCents;
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.ADMIN_SECRET = "test-secret-1234";
  process.env.PRICECHARTING_TOKEN = "test-token";
  resetEnvCache();
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetEnvCache();
  delete process.env.PRICECHARTING_TOKEN;
});

describe("PriceChartingAdapter — enablement", () => {
  it("is disabled with no token and refuses to fetch", async () => {
    delete process.env.PRICECHARTING_TOKEN;
    resetEnvCache();
    const a = new PriceChartingAdapter();
    expect(a.enabled()).toBe(false);
    await expect(a.fetchCardPrices(opSet("Wings of the Captain"), [card("OP06-118", "base")])).rejects.toThrow(/PRICECHARTING_TOKEN/);
  });

  it("is enabled with a token", () => {
    expect(new PriceChartingAdapter().enabled()).toBe(true);
  });
});

describe("PriceChartingAdapter — One Piece treatment matching", () => {
  it("keeps the four printings of one code distinct", async () => {
    const a = new PriceChartingAdapter();
    const set = opSet("Wings of the Captain");
    expect(await priceOne(a, set, card("OP06-118", "base"))).toBe(800);
    expect(await priceOne(a, set, card("OP06-118", "alt_art"))).toBe(13643);
    expect(await priceOne(a, set, card("OP06-118", "manga"))).toBe(274128);
  });

  it("maps both manga label spellings to the manga tier", async () => {
    const a = new PriceChartingAdapter();
    const rd = opSet("Romance Dawn");
    // "[Manga Alternate Art]" (Shanks) and "[Alternate Art Manga]" (Zoro).
    expect(await priceOne(a, rd, card("OP01-120", "manga"))).toBe(169505);
    expect(await priceOne(a, opSet("Wings of the Captain"), card("OP06-118", "manga"))).toBe(274128);
    // The plain "[Manga]" spelling too (via the unambiguous cross-set fallback).
    expect(await priceOne(a, opSet("Carrying on His Will"), card("OP13-118", "manga"))).toBe(207800);
  });

  it("keeps the alt art distinct from its manga (the Shanks $100 vs $1,695 case)", async () => {
    const a = new PriceChartingAdapter();
    const rd = opSet("Romance Dawn");
    expect(await priceOne(a, rd, card("OP01-120", "alt_art"))).toBe(10062);
    expect(await priceOne(a, rd, card("OP01-120", "manga"))).toBe(169505);
  });

  it("maps [Wanted] and [Wanted Poster] to wanted_poster", async () => {
    const a = new PriceChartingAdapter();
    expect(await priceOne(a, opSet("Kingdoms of Intrigue"), card("OP04-112", "wanted_poster"))).toBe(6000);
  });

  it("canonicalises our 'parallel' treatment to PriceCharting's [Alternate Art]", async () => {
    const a = new PriceChartingAdapter();
    expect(await priceOne(a, opSet("Paramount War"), card("OP02-069", "parallel"))).toBe(500);
  });

  it("maps the abbreviated [Alt Art] but not [Alt Art Errata]", async () => {
    const a = new PriceChartingAdapter();
    // The errata ($660) is a distinct misprint printing and must be ignored;
    // the plain [Alt Art] ($873) is the one that matches our alt_art card.
    expect(await priceOne(a, opSet("Romance Dawn"), card("OP01-003", "alt_art"))).toBe(87315);
  });

  it("matches SP", async () => {
    const a = new PriceChartingAdapter();
    expect(await priceOne(a, opSet("Paramount War"), card("OP02-060", "sp"))).toBe(5000);
  });

  it("ignores unmapped promo brackets", async () => {
    const a = new PriceChartingAdapter();
    // Championship 2024 ($500) is the only OP06-118 row with no modelled tier;
    // asking for a treatment nothing maps to returns nothing.
    expect(await priceOne(a, opSet("Wings of the Captain"), card("OP06-118", "championship"))).toBeUndefined();
  });

  it("excludes Japanese-console printings", async () => {
    const a = new PriceChartingAdapter();
    // The only manga row for this set under an English console is $2,741; the
    // Japanese $1,079 row must not win.
    expect(await priceOne(a, opSet("Wings of the Captain"), card("OP06-118", "manga"))).toBe(274128);
  });
});

describe("PriceChartingAdapter — One Piece cross-set reprints", () => {
  it("prices a reprint via its origin console when it appears in a later set", async () => {
    const a = new PriceChartingAdapter();
    // OP01-051 lives in the CSV only under "Romance Dawn", but we price it while
    // ingesting "Pillars of Strength" — the unambiguous fallback resolves it.
    expect(await priceOne(a, opSet("Pillars of Strength"), card("OP01-051", "wanted_poster"))).toBe(3950);
  });

  it("refuses the fallback when a code+treatment is ambiguous across consoles", async () => {
    const a = new PriceChartingAdapter();
    // OP99-001 base is $0.50 under Pillars of Strength and $500 under Reprint
    // Collection. Pricing it in a THIRD set must NOT grab either.
    expect(await priceOne(a, opSet("Some Other Set"), card("OP99-001", "base"))).toBeUndefined();
  });

  it("still resolves each ambiguous code correctly under its own console", async () => {
    const a = new PriceChartingAdapter();
    // The console-keyed primary lookup is exact, so the $0.50 base is never
    // confused with the $500 reprint — the whole reason the console key exists.
    expect(await priceOne(a, opSet("Pillars of Strength"), card("OP99-001", "base"))).toBe(50);
    expect(await priceOne(a, opSet("Reprint Collection"), card("OP99-001", "base"))).toBe(50000);
  });
});

describe("PriceChartingAdapter — Pokémon matching", () => {
  it("keys on set + collector number, base printing only", async () => {
    const a = new PriceChartingAdapter();
    // Squirtle #148 has a base ($2) and a reverse-holo ($3) row; base wins.
    expect(await priceOne(a, pkSet("sv7", "Stellar Crown"), card148("148", "base"))).toBe(200);
  });

  it("reconstructs a product name that contains a comma", async () => {
    const a = new PriceChartingAdapter();
    expect(await priceOne(a, pkSet("sv7", "Stellar Crown"), card148("155", "base"))).toBe(125);
  });

  it("applies the console-name override for 151 (sv3pt5)", async () => {
    const a = new PriceChartingAdapter();
    // set.name would give "Pokemon 151"; the override maps it to the real
    // "Pokemon Scarlet & Violet 151" console.
    expect(await priceOne(a, pkSet("sv3pt5", "151"), card148("199", "base"))).toBe(30000);
  });

  it("returns nothing for an unpriced number rather than guessing", async () => {
    const a = new PriceChartingAdapter();
    expect(await priceOne(a, pkSet("sv7", "Stellar Crown"), card148("999", "base"))).toBeUndefined();
  });
});

describe("PriceChartingAdapter — sealed products", () => {
  it("prices One Piece sealed by console + product name", async () => {
    const a = new PriceChartingAdapter();
    const out = await a.fetchSealedPrices(opSet("Wings of the Captain"));
    const byType = Object.fromEntries(out.map((s) => [s.externalProductId, s.priceCents]));
    expect(byType["booster_box"]).toBe(35395);
    expect(byType["booster_pack"]).toBe(650);
  });

  it("prices Pokémon sealed and falls back to the alternate box label", async () => {
    const a = new PriceChartingAdapter();
    const stellar = Object.fromEntries((await a.fetchSealedPrices(pkSet("sv7", "Stellar Crown"))).map((s) => [s.externalProductId, s.priceCents]));
    expect(stellar["booster_box"]).toBe(10000);
    expect(stellar["etb"]).toBe(4000);
    // Scarlet & Violet base has only "Base Set Booster Box" — the 2nd candidate.
    const svBase = Object.fromEntries((await a.fetchSealedPrices(pkSet("sv1", "Scarlet & Violet"))).map((s) => [s.externalProductId, s.priceCents]));
    expect(svBase["booster_box"]).toBe(50000);
  });
});

// A Pokémon card carries a plain number, never an OP-style code — that shape is
// how the adapter tells the two games apart.
function card148(number: string, treatment: string): PriceableCard {
  return { cardId: `pk-${number}`, name: number, number, rarity: "x", treatment, externalIds: { pokemontcg_io: `pk-${number}` } };
}
