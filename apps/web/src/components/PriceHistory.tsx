import type { MarketHistoryPoint } from "@/lib/data";
import { formatCents } from "@packroi/ev/format";

/**
 * Market-price sparkline for a sealed product, from daily snapshots. Purely
 * presentational (server component). Degrades gracefully: nothing to plot until
 * the daily cron has written at least two distinct days, so early on it just
 * says so rather than drawing a meaningless dot.
 */
export function PriceHistory({ data }: { data: MarketHistoryPoint[] }) {
  if (data.length < 2) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">Market price history</h2>
        <p className="mt-1 text-xs text-muted">
          {data.length === 1
            ? `One data point so far (${formatCents(data[0]!.cents)} on ${data[0]!.date}). `
            : "No history yet. "}
          The chart fills in as the daily price job accumulates snapshots.
        </p>
      </section>
    );
  }

  const W = 640;
  const H = 120;
  const PAD = 8;
  const values = data.map((d) => d.cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - 2 * PAD);
  const y = (c: number) => PAD + (1 - (c - min) / span) * (H - 2 * PAD);

  const line = data.map((d, i) => `${x(i).toFixed(1)},${y(d.cents).toFixed(1)}`).join(" ");
  const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`;

  const first = data[0]!;
  const last = data[data.length - 1]!;
  const change = last.cents - first.cents;
  const changePct = (change / first.cents) * 100;
  const up = change > 0;
  const flat = change === 0;
  const trendClass = flat ? "text-muted" : up ? "text-emerald-400" : "text-rose-400";

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Market price history</h2>
        <span className="text-xs text-muted">
          {data.length} days · {first.date} → {last.date}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-3">
        <span className="tabular text-xl font-semibold">{formatCents(last.cents)}</span>
        <span className={`tabular text-sm ${trendClass}`}>
          {flat ? "no change" : `${up ? "▲" : "▼"} ${formatCents(Math.abs(change))} (${changePct.toFixed(1)}%)`}
        </span>
        <span className="ml-auto text-xs text-muted">
          range {formatCents(min)}–{formatCents(max)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Market price from ${formatCents(first.cents)} on ${first.date} to ${formatCents(last.cents)} on ${last.date}`}
        className="mt-2 h-28 w-full"
      >
        <defs>
          <linearGradient id="ph-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#ph-fill)" className="text-accent" />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="text-accent"
        />
        <circle cx={x(data.length - 1)} cy={y(last.cents)} r={3.5} fill="currentColor" className="text-accent" />
      </svg>

      <p className="mt-1 text-[11px] text-muted">
        Daily median of eBay-sold (PriceCharting) sealed prices. Updates each time
        the price job runs.
      </p>
    </section>
  );
}
