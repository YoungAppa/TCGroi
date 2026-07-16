"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { rarityLabel } from "@/lib/catalog/rarities";
import { computeProduct } from "@/lib/data/compute";
import type { ProductPayload } from "@/lib/data/types";
import { blendPrices } from "@packroi/ev";
import { formatCents } from "@packroi/ev/format";
import { effectiveSources } from "@packroi/ev/url-state";

import { ConfidenceBadge, RoiCell } from "./badges";
import { SourceFilter } from "./SourceFilter";
import { useFilterState } from "./useFilterState";

export function SetDetail({
  products,
  availableSources,
}: {
  /** Every product of this set; cards are identical across them. */
  products: ProductPayload[];
  availableSources: { id: string; displayName: string }[];
}) {
  const { state, setState, withFilter } = useFilterState();
  const [sortByPrice, setSortByPrice] = useState(true);
  const availableIds = useMemo(() => availableSources.map((s) => s.id), [availableSources]);

  const first = products[0];

  const rows = useMemo(
    () => products.map((p) => ({ payload: p, c: computeProduct(p, state, availableIds) })),
    [products, state, availableIds],
  );

  const selectedSources = effectiveSources(state, availableIds);

  const cardList = useMemo(() => {
    if (!first) return [];
    const list = first.cards.map((c) => ({
      ...c,
      priceCents: blendPrices(c.raw, selectedSources, state.blend),
    }));
    if (sortByPrice) {
      return list.sort((a, b) => (b.priceCents ?? -1) - (a.priceCents ?? -1));
    }
    // Collector-number sort, numeric where possible.
    return list.sort((a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true }),
    );
  }, [first, selectedSources, state.blend, sortByPrice]);

  if (!first) return null;

  return (
    <div className="space-y-6">
      <SourceFilter
        available={availableSources}
        state={state}
        onChange={setState}
        gradedAvailable={false}
      />

      {/* ---- products of this set ---- */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Sealed products</h2>
          <ConfidenceBadge
            confidence={first.pullRates.confidence}
            sampleSizePacks={first.pullRates.sampleSizePacks}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">EV</th>
                <th className="px-3 py-2">MSRP</th>
                <th className="px-3 py-2">Retail ROI</th>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">Market ROI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ payload, c }) => (
                <tr key={payload.productId} className="border-b border-border/40 last:border-0 hover:bg-surface">
                  <td className="px-3 py-2">
                    <Link
                      href={withFilter(`/${payload.gameSlug}/${payload.setCode}/${payload.productSlug}`)}
                      className="font-medium hover:underline"
                    >
                      {payload.productName}
                    </Link>
                  </td>
                  <td className="tabular px-3 py-2">{formatCents(c.ev.evProductCents)}</td>
                  <td className="tabular px-3 py-2 text-muted">
                    {payload.msrpCents !== null ? formatCents(payload.msrpCents) : "—"}
                  </td>
                  <td className="tabular px-3 py-2">
                    <RoiCell roi={c.roiRetail} />
                  </td>
                  <td className="tabular px-3 py-2">
                    {payload.market.priceCents !== null
                      ? formatCents(payload.market.priceCents)
                      : "—"}
                    {payload.market.isManual && (
                      <span className="ml-1 text-amber-400" title="Hand-tracked market price">
                        *
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2">
                    <RoiCell roi={c.roiMarket} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- full card list ---- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            All cards <span className="text-sm font-normal text-muted">({cardList.length})</span>
          </h2>
          <button
            onClick={() => setSortByPrice((v) => !v)}
            className="rounded border border-border bg-surface px-3 py-1 text-xs text-muted hover:text-foreground"
          >
            sorted by {sortByPrice ? "price" : "number"} — switch
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Card</th>
                <th className="px-3 py-2">Rarity</th>
                <th className="px-3 py-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {cardList.map((c) => (
                <tr key={c.cardId} className="border-b border-border/40 last:border-0">
                  <td className="tabular px-3 py-1 text-muted">{c.number}</td>
                  <td className="px-3 py-1">{c.name}</td>
                  <td className="px-3 py-1 text-muted">{rarityLabel(c.rarity)}</td>
                  <td className="tabular px-3 py-1">
                    {c.priceCents !== null ? formatCents(c.priceCents) : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Prices from the selected sources ({selectedSources.join(", ")}). An
          unpriced card is excluded from EV, never counted as zero.
        </p>
      </section>
    </div>
  );
}
