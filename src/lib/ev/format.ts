/**
 * Display-edge helpers. This is the ONLY place fractional cents become a
 * rounded string — the engine deliberately carries fractions so that summing
 * ~8 tiers doesn't drift.
 */

/** Cents (possibly fractional) -> "$12.34". */
export function formatCents(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

/** 0.1234 -> "+12.3%"; -0.5 -> "-50.0%". Sign is always explicit. */
export function formatRoi(roi: number): string {
  const pct = roi * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** 0.398 -> "39.8%". For probabilities, where a sign would be noise. */
export function formatProbability(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

/**
 * 0.01 -> "1 in 100 packs". Rounds to a readable integer because "1 in 71.94"
 * implies a precision community pull-rate data does not have.
 */
export function formatOneIn(oneInPacks: number): string {
  if (!Number.isFinite(oneInPacks)) return "never";
  return `1 in ${Math.round(oneInPacks).toLocaleString("en-US")} packs`;
}
