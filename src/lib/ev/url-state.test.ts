import { describe, expect, it } from "vitest";

import {
  effectiveSources,
  parseFilterState,
  serializeFilterState,
  DEFAULT_FILTER_STATE,
} from "./url-state";

const parse = (qs: string) => parseFilterState(new URLSearchParams(qs));

describe("parseFilterState", () => {
  it("returns defaults for an empty query", () => {
    expect(parse("")).toEqual(DEFAULT_FILTER_STATE);
  });

  it("parses a full query", () => {
    expect(parse("src=a,b&blend=mean&mode=graded")).toEqual({
      sources: ["a", "b"],
      blend: "mean",
      graded: true,
    });
  });

  it("falls back to median for a nonsense blend rather than crashing the page", () => {
    expect(parse("blend=bogus").blend).toBe("median");
  });

  it("ignores empty entries from a malformed src", () => {
    expect(parse("src=a,,b,").sources).toEqual(["a", "b"]);
  });

  it("treats any mode other than graded as raw", () => {
    expect(parse("mode=raw").graded).toBe(false);
    expect(parse("mode=x").graded).toBe(false);
  });
});

describe("serializeFilterState", () => {
  it("serialises defaults to an empty string so canonical URLs stay clean", () => {
    expect(serializeFilterState(DEFAULT_FILTER_STATE)).toBe("");
  });

  it("round-trips through parse", () => {
    const state = { sources: ["a", "b"], blend: "max" as const, graded: true };
    expect(parse(serializeFilterState(state).slice(1))).toEqual(state);
  });

  it("omits each default individually", () => {
    expect(serializeFilterState({ sources: ["a"], blend: "median", graded: false })).toBe(
      "?src=a",
    );
    expect(serializeFilterState({ sources: [], blend: "mean", graded: false })).toBe(
      "?blend=mean",
    );
  });
});

describe("effectiveSources", () => {
  const available = ["tcgplayer_market", "pricecharting_ebay"];

  it("means 'everything available' when nothing is selected", () => {
    expect(effectiveSources(DEFAULT_FILTER_STATE, available)).toEqual(available);
  });

  it("respects a valid selection", () => {
    expect(
      effectiveSources({ ...DEFAULT_FILTER_STATE, sources: ["pricecharting_ebay"] }, available),
    ).toEqual(["pricecharting_ebay"]);
  });

  it("drops selections for sources that are no longer available", () => {
    // A share link from when pricecharting was enabled, opened after the
    // token lapsed: keep what's valid.
    expect(
      effectiveSources(
        { ...DEFAULT_FILTER_STATE, sources: ["pricecharting_ebay", "tcgplayer_market"] },
        ["tcgplayer_market"],
      ),
    ).toEqual(["tcgplayer_market"]);
  });

  it("falls back to everything when the whole selection is stale", () => {
    // Degrade to defaults rather than render a page of unknowns.
    expect(
      effectiveSources({ ...DEFAULT_FILTER_STATE, sources: ["gone"] }, available),
    ).toEqual(available);
  });
});
