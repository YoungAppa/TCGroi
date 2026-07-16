"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { computeForPayload } from "@/lib/data/compute";
import type { ProductPayload } from "@/lib/data/types";
import { formatCents, formatProbability } from "@/lib/ev/format";
import type { EvResult } from "@/lib/ev/types";

import { ConfidenceBadge, RoiCell } from "./badges";
import { SourceFilter } from "./SourceFilter";
import { useFilterState } from "./useFilterState";

type SortKey = "roi" | "ev" | "price" | "evPerPack" | "pSirBox";
type Row = { payload: ProductPayload; ev: EvResult };

/** The rarity whose per-box probability headlines the rankings, per game. */
const HEADLINE_RARITY: Record<string, string[]> = {
  pokemon: ["special_illustration_rare"],
  "one-piece": ["secret_rare", "manga_rare"],
};

function headlineProb(row: Row): number {
  const rarities = HEADLINE_RARITY[row.payload.gameSlug] ?? [];
  let best = 0;
  for (const r of rarities) {
    const p = row.ev.probAtLeastOne[r];
    if (p !== undefined && p > best) best = p;
  }
  return best;
}

const SORTS: Record<SortKey, (r: Row) => number> = {
  // null ROI sinks to the bottom rather than sorting as 0 (which would rank
  // "unknown" above genuinely bad boxes).
  roi: (r) => r.ev.roi ?? -Infinity,
  ev: (r) => r.ev.evProductCents,
  price: (r) => r.ev.sealedPriceCents ?? -Infinity,
  evPerPack: (r) => r.ev.evPackCents,
  pSirBox: headlineProb,
};

export function RankingsTable({
  products,
  availableSources,
}: {
  products: ProductPayload[];
  availableSources: { id: string; displayName: string }[];
}) {
  const { state, setState, withFilter } = useFilterState();
  const [sortKey, setSortKey] = useState<SortKey>("roi");
  const [sortDesc, setSortDesc] = useState(true);
  const [game, setGame] = useState<string>("all");

  const availableIds = useMemo(() => availableSources.map((s) => s.id), [availableSources]);

  // The instant-recompute promise: every EV on the page derives from the
  // payload + URL state, entirely client-side.
  const rows: Row[] = useMemo(
    () =>
      products
        .filter((p) => game === "all" || p.gameSlug === game)
        .filter((p) => p.pullRates.confidence !== "placeholder")
        .map((payload) => ({
          payload,
          ev: computeForPayload(payload, state, availableIds),
        })),
    [products, state, availableIds, game],
  );

  const sorted = useMemo(() => {
    const metric = SORTS[sortKey];
    return [...rows].sort((a, b) => (metric(b) - metric(a)) * (sortDesc ? 1 : -1));
  }, [rows, sortKey, sortDesc]);

  function clickSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const games = [...new Set(products.map((p) => p.gameSlug))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SourceFilter
          available={availableSources}
          state={state}
          onChange={setState}
          gradedAvailable={false /* wired in Phase 6 when a graded source exists */}
        />
        {games.length > 1 && (
          <select
            value={game}
            onChange={(e) => setGame(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-xs"
          >
            <option value="all">All games</option>
            {games.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">Product</th>
              <SortHeader label="ROI" k="roi" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              <SortHeader label="EV" k="ev" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              <SortHeader label="Price" k="price" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              <SortHeader label="EV / pack" k="evPerPack" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              <SortHeader label="P(top hit)/box" k="pSirBox" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              <th className="px-3 py-2 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ payload, ev }) => (
              <tr
                key={payload.productId}
                className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface"
              >
                <td className="px-3 py-2">
                  <Link
                    href={withFilter(
                      `/${payload.gameSlug}/${payload.setCode}/${payload.productSlug}`,
                    )}
                    className="block"
                  >
                    <span className="font-medium">{payload.setName}</span>{" "}
                    <span className="text-muted">{payload.productName}</span>
                  </Link>
                </td>
                <td className="tabular px-3 py-2">
                  <RoiCell roi={ev.roi} />
                </td>
                <td className="tabular px-3 py-2">{formatCents(ev.evProductCents)}</td>
                <td className="tabular px-3 py-2">
                  {ev.sealedPriceCents !== null ? formatCents(ev.sealedPriceCents) : "—"}
                  {payload.sealedIsPlaceholder && (
                    <span
                      title="Sealed price is a hand-entered placeholder until a sealed price source is connected"
                      className="ml-1 cursor-help text-amber-400"
                    >
                      *
                    </span>
                  )}
                </td>
                <td className="tabular px-3 py-2">{formatCents(ev.evPackCents)}</td>
                <td className="tabular px-3 py-2">
                  {formatProbability(headlineProb({ payload, ev }))}
                </td>
                <td className="px-3 py-2">
                  <ConfidenceBadge
                    confidence={payload.pullRates.confidence}
                    sampleSizePacks={payload.pullRates.sampleSizePacks}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        * Sealed prices marked with an asterisk are hand-entered placeholders —
        no configured price source covers sealed products yet. EV is computed
        from live card prices; ROI against a placeholder price is directional
        only.
      </p>
    </div>
  );
}

function SortHeader({
  label,
  k,
  cur,
  desc,
  onClick,
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  desc: boolean;
  onClick: (k: SortKey) => void;
}) {
  const active = cur === k;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide ${
          active ? "text-foreground" : "hover:text-foreground"
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (desc ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}
