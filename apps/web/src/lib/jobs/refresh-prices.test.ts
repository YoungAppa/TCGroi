import { describe, expect, it } from "vitest";

import { dedupeByKey } from "./refresh-prices";

const row = (cardId: string, priceCents: number, sourceId = "pricecharting_ebay") => ({
  cardId,
  sourceId,
  priceCents,
  kind: "raw" as const,
});

describe("dedupeByKey", () => {
  it("collapses rows sharing a conflict key to their median", () => {
    // Jungle: holo, non-holo, 1st Edition and shadowless PriceCharting rows all
    // matched one card. Postgres rejects the whole INSERT on a repeated key, so
    // this used to drop every base2 price silently.
    const out = dedupeByKey(
      [row("c1", 532), row("c1", 1_775), row("c1", 4_229), row("c1", 1_600), row("c1", 5_975)],
      (r) => r.cardId,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.priceCents).toBe(1_775);
  });

  it("keeps the median rather than the mean, so a 1st Edition print cannot drag it", () => {
    const out = dedupeByKey([row("c1", 100), row("c1", 120), row("c1", 40_000)], (r) => r.cardId);
    expect(out[0]!.priceCents).toBe(120);
  });

  it("treats different sources and kinds as separate rows", () => {
    const out = dedupeByKey(
      [row("c1", 100), row("c1", 900, "tcgplayer_market"), { ...row("c1", 5_000), kind: "psa10" }],
      (r) => r.cardId,
    );
    expect(out).toHaveLength(3);
  });

  it("leaves already-unique rows untouched", () => {
    const rows = [row("c1", 100), row("c2", 200), row("c3", 300)];
    expect(dedupeByKey(rows, (r) => r.cardId)).toHaveLength(3);
  });
});
