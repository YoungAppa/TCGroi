import { describe, expect, it } from "vitest";

import { parsePullRateFile, pullRateFileSchema } from "./schema";

const valid = {
  game: "pokemon",
  setCode: "sv8",
  version: 1,
  sampleSizePacks: 1000,
  sourceUrl: "https://example.test/pulls",
  sourceNote: "aggregated release-day case openings",
  confidence: "high",
  slots: [
    { rarity: "double_rare", perPackProbability: 0.2 },
    { rarity: "illustration_rare", perPackProbability: 0.111 },
  ],
};

const parse = (over: Record<string, unknown> = {}) =>
  pullRateFileSchema.safeParse({ ...valid, ...over });

describe("pullRateFileSchema — happy path", () => {
  it("accepts a well-formed file", () => {
    expect(parse().success).toBe(true);
  });

  it("defaults the optional collections", () => {
    const r = pullRateFileSchema.parse(valid);
    expect(r.guaranteedSlots).toEqual([]);
    expect(r.boxGuarantees).toEqual([]);
    // Placeholders must be opted in to, never defaulted on.
    expect(r.showWhenPlaceholder).toBe(false);
  });
});

describe("pullRateFileSchema — rarity vocabulary", () => {
  it("rejects a rarity the game does not have", () => {
    // Silent failure mode: the EV engine finds no cards for a misspelled tier
    // and contributes 0, which reads as a cheap set, not a broken file.
    const r = parse({ slots: [{ rarity: "hyprer_rare", perPackProbability: 0.1 }] });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("Unknown rarity");
  });

  it("rejects a rarity borrowed from the other game", () => {
    const r = parse({ slots: [{ rarity: "manga_rare", perPackProbability: 0.1 }] });
    expect(r.success).toBe(false);
  });

  it("accepts One Piece rarities for a One Piece file", () => {
    const r = parse({
      game: "one-piece",
      setCode: "OP-09",
      slots: [
        { rarity: "manga_rare", perPackProbability: 0.004 },
        { rarity: "wanted_poster", perPackProbability: 0.008 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("validates rarities in guaranteedSlots and boxGuarantees too", () => {
    expect(
      parse({ guaranteedSlots: [{ label: "x", rarity: "bogus", countPerPack: 1 }] }).success,
    ).toBe(false);
    expect(
      parse({
        boxGuarantees: [{ label: "x", rarity: "bogus", count: 1, mode: "floor" }],
      }).success,
    ).toBe(false);
  });
});

describe("pullRateFileSchema — structural errors", () => {
  it("rejects duplicate slots for one rarity", () => {
    const r = parse({
      slots: [
        { rarity: "double_rare", perPackProbability: 0.2 },
        { rarity: "double_rare", perPackProbability: 0.1 },
      ],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("counted twice");
  });

  it("rejects a probability above 1", () => {
    expect(parse({ slots: [{ rarity: "double_rare", perPackProbability: 1.5 }] }).success).toBe(
      false,
    );
  });

  it("rejects a negative probability", () => {
    expect(parse({ slots: [{ rarity: "double_rare", perPackProbability: -0.1 }] }).success).toBe(
      false,
    );
  });

  it("catches percentages entered as probabilities", () => {
    // The classic units error: 20 meaning 20%, not 20x per pack.
    const r = parse({
      confidence: "low",
      slots: [{ rarity: "double_rare", perPackProbability: 1 }, { rarity: "hyper_rare", perPackProbability: 1 }],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("not percentages");
  });

  it("requires a real URL for the source", () => {
    expect(parse({ sourceUrl: "somewhere on reddit" }).success).toBe(false);
  });

  it("requires a source note", () => {
    expect(parse({ sourceNote: "" }).success).toBe(false);
  });

  it("requires an explicit box-guarantee mode", () => {
    // No default: guessing "additive" silently inflates EV on exactly the
    // products that advertise a guarantee.
    const r = parse({
      boxGuarantees: [{ label: "SR or better", rarity: "double_rare", count: 1 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("pullRateFileSchema — honesty guards", () => {
  it("refuses high confidence on a thin sample", () => {
    const r = parse({ confidence: "high", sampleSizePacks: 50 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("requires sampleSizePacks >= 500");
  });

  it("refuses medium confidence on a very thin sample", () => {
    expect(parse({ confidence: "medium", sampleSizePacks: 20 }).success).toBe(false);
  });

  it("allows low confidence on a thin sample", () => {
    expect(parse({ confidence: "low", sampleSizePacks: 20 }).success).toBe(true);
  });

  it("rejects a zero sample on a non-placeholder table", () => {
    // 0 packs opened IS a placeholder, whatever the file claims.
    const r = parse({ confidence: "low", sampleSizePacks: 0 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("no packs were opened");
  });

  it("allows an undisclosed sample size at low confidence", () => {
    // The common real case: a site publishes rates but not its N. That is a
    // genuine estimate, not an invention — null, not 0.
    expect(parse({ confidence: "low", sampleSizePacks: null }).success).toBe(true);
  });

  it("caps an undisclosed sample size at low confidence", () => {
    // Cannot claim precision from a sample we were never told the size of,
    // however plausible the numbers look.
    const r = parse({ confidence: "medium", sampleSizePacks: null });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("did not publish one");

    expect(parse({ confidence: "high", sampleSizePacks: null }).success).toBe(false);
  });

  it("forbids a placeholder from claiming a sample size", () => {
    // A placeholder with sampleSizePacks: 800 is a fabrication wearing a
    // disclaimer. The schema makes it unrepresentable.
    const r = parse({ confidence: "placeholder", sampleSizePacks: 800 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("no packs were opened for it");
  });

  it("accepts a well-formed placeholder", () => {
    expect(parse({ confidence: "placeholder", sampleSizePacks: 0 }).success).toBe(true);
  });
});

describe("parsePullRateFile", () => {
  it("returns the parsed file", () => {
    expect(parsePullRateFile(valid, "sv8.json").setCode).toBe("sv8");
  });

  it("throws naming the file and every issue", () => {
    expect(() => parsePullRateFile({ ...valid, confidence: "high", sampleSizePacks: 1 }, "sv8.json")).toThrow(
      /sv8\.json/,
    );
  });
});
