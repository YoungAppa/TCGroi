import { describe, expect, it } from "vitest";

import { computeDisagreements, hasMaterialDisagreement } from "./disagreement";
import { pullRateFileSchema, type PullRateFile } from "./schema";

const file = (over: Record<string, unknown> = {}): PullRateFile =>
  pullRateFileSchema.parse({
    game: "pokemon",
    setCode: "sv8",
    version: 1,
    sampleSizePacks: null,
    sourceUrl: "https://example.test/a",
    sourceNote: "primary",
    confidence: "low",
    slots: [
      { rarity: "special_illustration_rare", perPackProbability: 0.0115 },
      { rarity: "hyper_rare", perPackProbability: 0.0053 },
    ],
    ...over,
  });

describe("computeDisagreements", () => {
  it("returns nothing when there are no alternates", () => {
    expect(computeDisagreements(file())).toEqual([]);
  });

  it("reports the spread for a contested tier", () => {
    // The real Surging Sparks case: 0.014 (1-in-71) vs 0.0115 (1-in-87).
    const d = computeDisagreements(
      file({
        alternateEstimates: [
          {
            sourceUrl: "https://example.test/b",
            note: "500-pack opening",
            sampleSizePacks: 500,
            slots: [{ rarity: "special_illustration_rare", perPackProbability: 0.014 }],
          },
        ],
      }),
    );

    expect(d).toHaveLength(1);
    expect(d[0]!.rarity).toBe("special_illustration_rare");
    expect(d[0]!.primaryProbability).toBe(0.0115);
    expect(d[0]!.alternates[0]!.probability).toBe(0.014);
    // 0.014 / 0.0115 - 1 = 0.2174
    expect(d[0]!.alternates[0]!.relativeDifference).toBeCloseTo(0.2174, 4);
    expect(d[0]!.maxRelativeDifference).toBeCloseTo(0.2174, 4);
  });

  it("ignores tiers the alternate does not contest", () => {
    const d = computeDisagreements(
      file({
        alternateEstimates: [
          {
            sourceUrl: "https://example.test/b",
            note: "x",
            sampleSizePacks: 500,
            slots: [{ rarity: "special_illustration_rare", perPackProbability: 0.014 }],
          },
        ],
      }),
    );
    // hyper_rare is uncontested, so it does not appear.
    expect(d.map((x) => x.rarity)).toEqual(["special_illustration_rare"]);
  });

  it("reports a negative difference when the alternate is lower", () => {
    const d = computeDisagreements(
      file({
        alternateEstimates: [
          {
            sourceUrl: "https://example.test/b",
            note: "x",
            sampleSizePacks: 100,
            slots: [{ rarity: "special_illustration_rare", perPackProbability: 0.0092 }],
          },
        ],
      }),
    );
    expect(d[0]!.alternates[0]!.relativeDifference).toBeCloseTo(-0.2, 4);
    // Magnitude is what matters for "do sources disagree".
    expect(d[0]!.maxRelativeDifference).toBeCloseTo(0.2, 4);
  });

  it("takes the largest spread across several alternates", () => {
    const d = computeDisagreements(
      file({
        alternateEstimates: [
          {
            sourceUrl: "https://example.test/b",
            note: "x",
            sampleSizePacks: 500,
            slots: [{ rarity: "special_illustration_rare", perPackProbability: 0.0126 }],
          },
          {
            sourceUrl: "https://example.test/c",
            note: "y",
            sampleSizePacks: 900,
            slots: [{ rarity: "special_illustration_rare", perPackProbability: 0.023 }],
          },
        ],
      }),
    );
    expect(d[0]!.alternates).toHaveLength(2);
    expect(d[0]!.maxRelativeDifference).toBeCloseTo(1.0, 4);
  });

  it("does not divide by a zero primary probability", () => {
    const d = computeDisagreements(
      file({
        slots: [{ rarity: "hyper_rare", perPackProbability: 0 }],
        alternateEstimates: [
          {
            sourceUrl: "https://example.test/b",
            note: "x",
            sampleSizePacks: 500,
            slots: [{ rarity: "hyper_rare", perPackProbability: 0.01 }],
          },
        ],
      }),
    );
    expect(Number.isFinite(d[0]!.maxRelativeDifference)).toBe(true);
  });
});

describe("hasMaterialDisagreement", () => {
  const withAlt = (p: number) =>
    file({
      alternateEstimates: [
        {
          sourceUrl: "https://example.test/b",
          note: "x",
          sampleSizePacks: 500,
          slots: [{ rarity: "special_illustration_rare", perPackProbability: p }],
        },
      ],
    });

  it("flags the real Surging Sparks spread", () => {
    expect(hasMaterialDisagreement(withAlt(0.014))).toBe(true);
  });

  it("stays quiet when sources broadly agree", () => {
    // ~4% apart — noise, not a story.
    expect(hasMaterialDisagreement(withAlt(0.012))).toBe(false);
  });

  it("is quiet when there is nothing to compare", () => {
    expect(hasMaterialDisagreement(file())).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(hasMaterialDisagreement(withAlt(0.014), 0.5)).toBe(false);
  });
});

describe("alternateEstimates validation", () => {
  it("rejects an alternate for a tier the primary does not list", () => {
    const r = pullRateFileSchema.safeParse({
      game: "pokemon",
      setCode: "sv8",
      version: 1,
      sampleSizePacks: null,
      sourceUrl: "https://example.test/a",
      sourceNote: "primary",
      confidence: "low",
      slots: [{ rarity: "hyper_rare", perPackProbability: 0.005 }],
      alternateEstimates: [
        {
          sourceUrl: "https://example.test/b",
          note: "x",
          sampleSizePacks: 500,
          slots: [{ rarity: "double_rare", perPackProbability: 0.2 }],
        },
      ],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("nothing to compare it to");
  });
});
