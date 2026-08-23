import { getEnv } from "@/lib/env";

import type { CatalogSet } from "@/lib/catalog/types";

import type {
  PriceableCard,
  PriceSnapshotInput,
  PriceSourceAdapter,
} from "../types";

/**
 * Skinport prices for Counter-Strike 2 — skin prices (cards) and case prices
 * (sealed products), from Skinport's items API (`/v1/items?app_id=730`), which
 * returns one row per market_hash_name with the current lowest listing.
 *
 * The listed price is stored as the raw price. The "Cashout" figure the UI shows
 * — what you actually pocket after Skinport's sell fee — is derived from it at
 * the value layer, so it can move with the fee schedule without a re-fetch.
 *
 * Access note: the public endpoint is Cloudflare-gated against automated
 * clients, so this reads SKINPORT_API_BASE (a reachable path — a proxy or the
 * authenticated host) and an optional SKINPORT_API_KEY bearer. Disabled — and
 * CS2 therefore unpriced — until one is configured; the rest of the site is
 * unaffected.
 *
 * v1 skin pricing is a representative wear price (the median across a skin's
 * listed wear/StatTrak variants). Proper float→wear weighting is a follow-up,
 * best done against real responses.
 */

interface SkinportItem {
  market_hash_name: string;
  min_price: number | null;
  median_price: number | null;
  suggested_price: number | null;
  currency: string;
}

export class SkinportAdapter implements PriceSourceAdapter {
  readonly id = "skinport";
  readonly displayName = "Skinport";
  readonly supports = { cardsRaw: true, cardsGraded: false, sealed: true };

  /** market_hash_name -> best listed price in cents; built once per process. */
  private itemsPromise: Promise<Map<string, number>> | null = null;

  enabled(): boolean {
    return getEnv().SKINPORT_API_KEY !== undefined;
  }

  private async items(): Promise<Map<string, number>> {
    if (this.itemsPromise) return this.itemsPromise;
    this.itemsPromise = (async () => {
      const env = getEnv();
      const url = `${env.SKINPORT_API_BASE.replace(/\/$/, "")}/v1/items?app_id=730&currency=USD&tradable=0`;
      const headers: Record<string, string> = { "Accept-Encoding": "br" };
      if (env.SKINPORT_API_KEY) headers.Authorization = `Bearer ${env.SKINPORT_API_KEY}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Skinport /v1/items ${res.status}`);
      const rows = (await res.json()) as SkinportItem[];
      const map = new Map<string, number>();
      for (const r of rows) {
        // Lowest current listing is the realistic "what it's worth" price; fall
        // back to median/suggested when nothing is listed right now.
        const dollars = r.min_price ?? r.median_price ?? r.suggested_price;
        if (dollars != null && dollars > 0) map.set(r.market_hash_name, Math.round(dollars * 100));
      }
      return map;
    })();
    return this.itemsPromise;
  }

  /** Cases trade as a single item named exactly after the case. */
  async fetchSealedPrices(set: CatalogSet): Promise<PriceSnapshotInput[]> {
    const items = await this.items();
    const cents = items.get(set.name);
    if (cents === undefined) return [];
    return [
      {
        externalProductId: `case:${set.code}`,
        sourceId: this.id,
        priceCents: cents,
        kind: "raw",
        capturedAt: new Date(),
      },
    ];
  }

  async fetchCardPrices(_set: CatalogSet, cards: PriceableCard[]): Promise<PriceSnapshotInput[]> {
    const items = await this.items();
    const out: PriceSnapshotInput[] = [];
    for (const card of cards) {
      const base = card.externalIds.market_hash_name ?? card.name;
      // Representative price: median of every listed wear/StatTrak variant of
      // this skin. v1 approximation — proper wear weighting comes later.
      const prices: number[] = [];
      for (const [name, cents] of items) {
        if (name.startsWith(base + " (") || name === base) prices.push(cents);
      }
      if (prices.length === 0) continue;
      prices.sort((a, b) => a - b);
      const median = prices[Math.floor((prices.length - 1) / 2)]!;
      out.push({
        externalCardId: card.externalIds.bymykel ?? card.number,
        sourceId: this.id,
        priceCents: median,
        kind: "raw",
        capturedAt: new Date(),
      });
    }
    return out;
  }
}
