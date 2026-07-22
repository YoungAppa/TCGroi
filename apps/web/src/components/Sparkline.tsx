"use client";

import { formatCents } from "@packroi/ev/format";

interface Point {
  date: string;
  cents: number;
}

/**
 * Small responsive price/value line chart from daily points. Client component
 * so the collection (localStorage-driven) can render it after fetching history.
 * Below two points there's nothing to draw, so it says so — history grows as
 * the daily price job accumulates snapshots.
 */
export function Sparkline({
  data,
  height = 160,
  emptyLabel = "The chart fills in as daily prices accumulate.",
}: {
  data: Point[];
  height?: number;
  emptyLabel?: string;
}) {
  if (data.length < 2) {
    return <p className="py-6 text-center text-xs text-muted">{emptyLabel}</p>;
  }

  const W = 800;
  const H = height;
  const PAD = 10;
  const values = data.map((d) => d.cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - 2 * PAD);
  const y = (c: number) => H - PAD - ((c - min) / range) * (H - 2 * PAD);

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.cents).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  const last = data[data.length - 1]!;
  const first = data[0]!;
  const up = last.cents >= first.cents;
  const stroke = up ? "var(--roi-pos)" : "var(--roi-neg)";

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={x(data.length - 1)} cy={y(last.cents)} r="3" fill={stroke} />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span className="tabular">
          {first.date} · {formatCents(first.cents)}
        </span>
        <span className="tabular">
          {last.date} · {formatCents(last.cents)}
        </span>
      </div>
    </div>
  );
}
