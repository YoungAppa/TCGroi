import { describe, expect, it } from "vitest";

import { gradingCost, PSA_FEE_TIERS } from "./fees";

describe("gradingCost", () => {
  it("uses Regular ($79.99) as the floor — the Value tiers are paused", () => {
    // A cheap card can't reach a sub-$79.99 tier any more; the paused Value
    // tiers ($24.99 etc.) must not reappear in the schedule.
    const g = gradingCost(1_500); // $15 raw
    expect(g.service).toBe("Regular");
    expect(g.feeCents).toBe(7_999);
    expect(PSA_FEE_TIERS.some((t) => t.feeCents < 7_999)).toBe(false);
  });

  it("prices the tier off the DECLARED (graded) value, not the raw value", () => {
    // Raw $800 would sit in Regular, but a $3,000 PSA 10 needs Super Express.
    const byRaw = gradingCost(80_000);
    expect(byRaw.service).toBe("Regular");

    const byDeclared = gradingCost(80_000, 300_000);
    expect(byDeclared.service).toBe("Super Express");
    expect(byDeclared.feeCents).toBe(34_900);
  });

  it("break-even is raw + fee, and uses the raw value even when declared is higher", () => {
    const g = gradingCost(80_000, 300_000);
    expect(g.breakEvenCents).toBe(80_000 + 34_900);
  });

  it("falls back to the raw value for the tier when no declared value is given", () => {
    expect(gradingCost(200_000).service).toBe("Express"); // $2,000 → ≤$2,500
  });

  it("keeps the tiers ascending with a finite Regular floor and open-ended top", () => {
    const maxes = PSA_FEE_TIERS.map((t) => t.maxValueCents);
    expect([...maxes].sort((a, b) => a - b)).toEqual(maxes);
    expect(maxes.at(-1)).toBe(Number.POSITIVE_INFINITY);
  });
});
