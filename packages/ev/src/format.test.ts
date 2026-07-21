import { describe, expect, it } from "vitest";

import {
  formatCents,
  formatOneIn,
  formatPerPackChance,
  formatProbability,
  formatRoi,
} from "./format";

describe("formatCents", () => {
  it("formats whole cents", () => {
    expect(formatCents(1234)).toBe("$12.34");
  });

  it("rounds fractional cents at the display edge", () => {
    expect(formatCents(1234.6)).toBe("$12.35");
  });

  it("always shows two decimal places", () => {
    expect(formatCents(1200)).toBe("$12.00");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats negative values", () => {
    expect(formatCents(-500)).toBe("$-5.00");
  });
});

describe("formatRoi", () => {
  it("marks a positive ROI with an explicit +", () => {
    expect(formatRoi(0.1234)).toBe("+12.3%");
  });

  it("formats a negative ROI", () => {
    expect(formatRoi(-0.5)).toBe("-50.0%");
  });

  it("formats break-even as +0.0%", () => {
    expect(formatRoi(0)).toBe("+0.0%");
  });
});

describe("formatProbability", () => {
  it("renders a probability as a percentage", () => {
    expect(formatProbability(0.398)).toBe("39.8%");
  });

  it("renders certainty and impossibility", () => {
    expect(formatProbability(1)).toBe("100.0%");
    expect(formatProbability(0)).toBe("0.0%");
  });
});

describe("formatPerPackChance", () => {
  it("renders ordinary per-pack odds like formatProbability", () => {
    expect(formatPerPackChance(0.044)).toBe("4.4%"); // a Double Rare / N
    expect(formatPerPackChance(0.004)).toBe("0.4%"); // a 1-in-225 SIR
  });

  it("floors the long tail instead of rounding to a misleading 0.0%", () => {
    // 1 in 1,111 packs = 0.09% — real, but toFixed(1) would show "0.0%".
    expect(formatPerPackChance(1 / 1111)).toBe("<0.1%");
    expect(formatPerPackChance(1 / 5000)).toBe("<0.1%");
  });

  it("renders a true zero as 0%", () => {
    expect(formatPerPackChance(0)).toBe("0%");
  });
});

describe("formatOneIn", () => {
  it("phrases odds as 1 in N packs", () => {
    expect(formatOneIn(100)).toBe("1 in 100 packs");
  });

  it("rounds — community data does not support decimal precision here", () => {
    expect(formatOneIn(71.94)).toBe("1 in 72 packs");
  });

  it("groups thousands for readability", () => {
    expect(formatOneIn(1250)).toBe("1 in 1,250 packs");
  });

  it("says never rather than printing Infinity", () => {
    expect(formatOneIn(Infinity)).toBe("never");
  });
});
