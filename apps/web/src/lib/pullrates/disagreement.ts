import type { PullRateFile } from "./schema";

/**
 * Computes the spread between the rate we use and any rival published
 * estimates, for display on the product page.
 *
 * Pure. This never feeds the EV math — it exists so the user can see that the
 * community does not agree, rather than being handed one number dressed up as
 * fact.
 */

export interface TierDisagreement {
  rarity: string;
  /** The probability the EV engine used. */
  primaryProbability: number;
  /** Rival estimates for the same tier. */
  alternates: {
    sourceUrl: string;
    note: string;
    sampleSizePacks: number | null;
    probability: number;
    /** Signed relative difference vs primary, e.g. +0.22 for 22% higher. */
    relativeDifference: number;
  }[];
  /** Largest absolute relative difference across the alternates. */
  maxRelativeDifference: number;
}

export function computeDisagreements(file: PullRateFile): TierDisagreement[] {
  const out: TierDisagreement[] = [];

  for (const slot of file.slots) {
    const alternates: TierDisagreement["alternates"] = [];

    for (const alt of file.alternateEstimates) {
      const altSlot = alt.slots.find((s) => s.rarity === slot.rarity);
      if (!altSlot) continue;

      // Guard the divide: a primary of 0 makes relative difference undefined
      // rather than infinite-and-meaningless.
      const rel =
        slot.perPackProbability > 0
          ? altSlot.perPackProbability / slot.perPackProbability - 1
          : 0;

      alternates.push({
        sourceUrl: alt.sourceUrl,
        note: alt.note,
        sampleSizePacks: alt.sampleSizePacks,
        probability: altSlot.perPackProbability,
        relativeDifference: rel,
      });
    }

    if (alternates.length === 0) continue;

    out.push({
      rarity: slot.rarity,
      primaryProbability: slot.perPackProbability,
      alternates,
      maxRelativeDifference: Math.max(
        ...alternates.map((a) => Math.abs(a.relativeDifference)),
      ),
    });
  }

  return out;
}

/**
 * True when at least one tier's sources disagree by more than `threshold`
 * (default 15%). Drives a "sources disagree" notice on the product page.
 */
export function hasMaterialDisagreement(file: PullRateFile, threshold = 0.15): boolean {
  return computeDisagreements(file).some((d) => d.maxRelativeDifference > threshold);
}
