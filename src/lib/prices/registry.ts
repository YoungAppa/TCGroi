import { PriceChartingAdapter } from "./adapters/pricecharting";
import { EbayDirectAdapter, CardmarketAdapter } from "./adapters/stubs";
import { TcgplayerMarketAdapter } from "./adapters/tcgplayer-market";
import type { PriceSourceAdapter } from "./types";

/**
 * Every known price source. The UI's source filter is exactly the enabled
 * subset of this list, which is what makes "the site works with no price
 * source configured" a structural property rather than a promise.
 */
export function allPriceAdapters(): PriceSourceAdapter[] {
  return [
    new TcgplayerMarketAdapter(),
    new PriceChartingAdapter(),
    new EbayDirectAdapter(),
    new CardmarketAdapter(),
  ];
}

export function enabledPriceAdapters(): PriceSourceAdapter[] {
  return allPriceAdapters().filter((a) => a.enabled());
}

/** Adapters that can supply psa9/psa10. Empty => graded mode is hidden. */
export function gradedCapableAdapters(): PriceSourceAdapter[] {
  return enabledPriceAdapters().filter((a) => a.supports.cardsGraded);
}

export function isGradedModeAvailable(): boolean {
  return gradedCapableAdapters().length > 0;
}
