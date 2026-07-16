import type { BlendStrategy, Cents, PriceBySource } from "./types";

/** Median of a numeric list. Returns null for empty input. Non-mutating. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Combines the prices of the selected sources into one number.
 *
 * A selected source with no price for this entity is skipped, not counted as
 * zero — toggling on a source that lacks One Piece coverage must not drag
 * every One Piece EV down. Returns null when no selected source has data,
 * which callers treat as "unknown", never as "free".
 */
export function blendPrices(
  prices: PriceBySource,
  selectedSources: string[],
  strategy: BlendStrategy,
): Cents | null {
  const values: number[] = [];
  for (const id of selectedSources) {
    const p = prices[id];
    // Explicit undefined check: a legitimate 0 must survive.
    if (p !== undefined) values.push(p);
  }

  if (values.length === 0) return null;

  switch (strategy) {
    case "median":
      return median(values);
    case "mean":
      return mean(values);
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}
