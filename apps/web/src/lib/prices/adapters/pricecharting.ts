import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import type { CatalogSet } from "@/lib/catalog/types";
import { getEnv } from "@/lib/env";

import {
  PriceSourceError,
  type PriceSourceAdapter,
  type PriceSnapshotInput,
  type PriceableCard,
} from "../types";

/**
 * PriceCharting — our eBay-sold source, our graded source, and our best sealed
 * source, all in one.
 *
 * Requires a paid subscription token. Absent => enabled() is false, the UI
 * hides the source, graded mode disappears, and One Piece has no prices at
 * all. The site must work in that state, and CI builds it that way.
 *
 * Their API returns integer pennies already, so no float conversion happens
 * here — a rare and welcome property.
 *
 * NOT YET VERIFIED AGAINST THE LIVE API. Everything below is written to their
 * documented shape but has never seen a real response, because we have no
 * token. The field mapping — especially the graded price keys and how sealed
 * products are identified — must be checked against one real call before this
 * is trusted. Zod will reject a mismatch loudly rather than silently mis-price.
 */
const BASE = "https://www.pricecharting.com/api";

/**
 * Documented fields. PriceCharting names price fields by console/grade in
 * pennies:
 *   loose-price      -> ungraded / raw
 *   graded-price     -> PSA 9
 *   manual-only-price-> PSA 10 (their field naming is historical, from video
 *                       games; for cards it carries the PSA 10 value)
 * That mapping is exactly the sort of thing that must be confirmed live before
 * launch — getting it wrong swaps PSA 9 and PSA 10 across the whole site.
 */
const productSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  "product-name": z.string().nullish(),
  "console-name": z.string().nullish(),
  "loose-price": z.number().int().nullish(),
  "graded-price": z.number().int().nullish(),
  "manual-only-price": z.number().int().nullish(),
  "box-only-price": z.number().int().nullish(),
  status: z.string().nullish(),
});

const productsResponse = z.object({
  status: z.string().nullish(),
  products: z.array(productSchema).nullish(),
});

export class PriceChartingAdapter implements PriceSourceAdapter {
  readonly id = "pricecharting_ebay";
  readonly displayName = "eBay (sold)";
  readonly supports = { cardsRaw: true, cardsGraded: true, sealed: true };

  private token(): string | undefined {
    return getEnv().PRICECHARTING_TOKEN;
  }

  enabled(): boolean {
    return this.token() !== undefined;
  }

  private assertEnabled(): string {
    const t = this.token();
    if (!t) {
      throw new PriceSourceError(
        "PRICECHARTING_TOKEN is not configured — callers must check enabled() first",
        this.id,
      );
    }
    return t;
  }

  async fetchCardPrices(
    set: CatalogSet,
    cards: PriceableCard[],
  ): Promise<PriceSnapshotInput[]> {
    const token = this.assertEnabled();
    const out: PriceSnapshotInput[] = [];

    // One request per card. PriceCharting has no bulk-by-set endpoint, which
    // is why refresh-prices prioritises sealed first, then cards >= $1, then
    // bulk weekly — a 250-card set is 250 calls against a quota.
    for (const card of cards) {
      const ext = card.externalIds["pricecharting"];
      if (!ext) continue;

      const res = await fetchJson(
        `${BASE}/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(ext)}`,
        productsResponse,
        { provider: this.id },
      );

      const p = res.products?.[0];
      if (!p) continue;

      const capturedAt = new Date();
      // Already pennies — do not multiply.
      if (typeof p["loose-price"] === "number") {
        out.push({
          externalCardId: ext,
          sourceId: this.id,
          priceCents: p["loose-price"],
          kind: "raw",
          capturedAt,
        });
      }
    }

    return out;
  }

  async fetchGradedPrices(cards: PriceableCard[]): Promise<PriceSnapshotInput[]> {
    const token = this.assertEnabled();
    const out: PriceSnapshotInput[] = [];

    for (const card of cards) {
      const ext = card.externalIds["pricecharting"];
      if (!ext) continue;

      const res = await fetchJson(
        `${BASE}/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(ext)}`,
        productsResponse,
        { provider: this.id },
      );

      const p = res.products?.[0];
      if (!p) continue;

      const capturedAt = new Date();
      if (typeof p["graded-price"] === "number") {
        out.push({
          externalCardId: ext,
          sourceId: this.id,
          priceCents: p["graded-price"],
          kind: "psa9",
          capturedAt,
        });
      }
      if (typeof p["manual-only-price"] === "number") {
        out.push({
          externalCardId: ext,
          sourceId: this.id,
          priceCents: p["manual-only-price"],
          kind: "psa10",
          capturedAt,
        });
      }
    }

    return out;
  }

  async fetchSealedPrices(): Promise<PriceSnapshotInput[]> {
    this.assertEnabled();
    // Sealed products must be matched to PriceCharting ids first; that mapping
    // lives on sealed_products.externalIds and is populated by hand or by the
    // admin UI. Until a token exists there is nothing to map against.
    return [];
  }
}
