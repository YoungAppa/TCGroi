/**
 * The EV/ROI math engine.
 *
 * Pure by contract: zero I/O, no clock, no randomness, no DB. Everything it
 * needs is passed in. That contract is what lets the same code run in a cron
 * job (to precompute) and in the browser (to recompute instantly when the user
 * toggles a price source) with identical results.
 */
export { computeEv, packsForProbability, type EvInput } from "./compute";
export { blendPrices, mean, median } from "./blend";
export { effectiveCardValue, type CardValue } from "./value";
export { groupByRarity, tierValue, type TierValue } from "./tiers";
export {
  formatCents,
  formatOneIn,
  formatProbability,
  formatRoi,
} from "./format";
export * from "./types";
