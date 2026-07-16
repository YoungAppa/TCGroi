import {
  computeEv,
  DEFAULT_EV_OPTIONS,
  type EvOptions,
  type EvResult,
  type PullRateTable,
  type SealedProductInput,
} from "@/lib/ev";
import { effectiveSources, type FilterState } from "@/lib/ev/url-state";

import type { ProductPayload } from "./types";

/**
 * ProductPayload + URL filter state -> EvResult.
 *
 * Pure, and shared verbatim by the rankings table and the product page, so a
 * product can never show one ROI in the list and another on its own page.
 * Runs client-side on every source toggle — that this is cheap is guaranteed
 * by the EV engine's purity, not by memoisation heroics.
 */
export function computeForPayload(
  payload: ProductPayload,
  filter: FilterState,
  availableSourceIds: string[],
): EvResult {
  const table: PullRateTable = {
    setId: payload.setCode,
    version: payload.pullRates.version,
    sampleSizePacks: payload.pullRates.sampleSizePacks ?? 0,
    sourceUrl: payload.pullRates.sourceUrl,
    sourceNote: payload.pullRates.sourceNote,
    confidence: payload.pullRates.confidence,
    slots: payload.pullRates.slots,
    guaranteedSlots: payload.pullRates.guaranteedSlots,
  };

  const product: SealedProductInput = {
    productId: payload.productId,
    name: payload.productName,
    slug: payload.productSlug,
    type: payload.productType,
    packsContained: payload.packsContained,
    msrpCents: payload.msrpCents,
    sealed: payload.sealed,
    guaranteedCardIds: payload.guaranteedCardIds,
    boxGuarantees: payload.boxGuarantees,
  };

  const opts: EvOptions = {
    ...DEFAULT_EV_OPTIONS,
    selectedSources: effectiveSources(filter, availableSourceIds),
    blend: filter.blend,
    graded: filter.graded,
  };

  return computeEv({ product, table, cards: payload.cards }, opts);
}
