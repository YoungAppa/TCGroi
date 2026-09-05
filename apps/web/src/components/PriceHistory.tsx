"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useMoney } from "@/lib/money/context";

export interface PricePoint {
  /** YYYY-MM-DD. */
  date: string;
  cents: number;
}

type RangeKey = "1D" | "7D" | "1M" | "3M" | "1Y" | "ALL";
const RANGES: { key: RangeKey; days: number | null }[] = [
  { key: "1D", days: 1 },
  { key: "7D", days: 7 },
  { key: "1M", days: 30 },
  { key: "3M", days: 91 },
  { key: "1Y", days: 365 },
  { key: "ALL", days: null },
];

const dayMs = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string, withYear = true) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${day}${withYear ? `, ${y}` : ""}`;
};

/**
 * Interactive price history, the way a collector app does it: pick a range
 * (1D/7D/1M/3M/1Y/ALL), scrub across the line with a mouse or a finger and the
 * header shows the exact date and price under the cursor, with the change
 * measured from the start of the range. One point per day — the price job
 * runs daily — so "1D" is the day-over-day move, and ranges with fewer than
 * two days of history are disabled rather than drawn as a dot.
 */
export function PriceHistory({
  data,
  title = "Market price history",
  note = "Daily median of eBay-sold (PriceCharting) sealed prices. Updates each time the price job runs.",
  compact = false,
}: {
  data: PricePoint[];
  title?: string;
  note?: string;
  /** Sits beside other cards: shorter plot, fills its column's height. */
  compact?: boolean;
}) {
  const { money } = useMoney();

  // Ranges are anchored on the latest snapshot, not the clock: a day without
  // a price run shouldn't silently empty the shorter ranges.
  const lastMs = data.length ? toMs(data[data.length - 1]!.date) : 0;
  const windows = useMemo(
    () =>
      RANGES.map((r) => ({
        ...r,
        points: r.days === null ? data : data.filter((p) => toMs(p.date) >= lastMs - r.days! * dayMs),
      })),
    [data, lastMs],
  );
  const usable = (k: RangeKey) => (windows.find((w) => w.key === k)?.points.length ?? 0) >= 2;
  const [range, setRange] = useState<RangeKey>(() => (usable("1M") ? "1M" : "ALL"));
  const points = windows.find((w) => w.key === range)?.points ?? data;

  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => setHover(null), [range]);

  if (data.length < 2) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted">
          {data.length === 1
            ? `One data point so far (${money(data[0]!.cents)} on ${fmtDate(data[0]!.date)}). `
            : "No history yet. "}
          The chart fills in as the daily price job accumulates snapshots.
        </p>
      </section>
    );
  }

  const W = 640;
  const H = 160;
  const PAD_X = 4;
  const PAD_Y = 10;
  const values = points.map((d) => d.cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, min * 0.02);
  const lo = span === max - min ? min : min - span / 2;
  const hi = span === max - min ? max : max + span / 2;
  const xf = (i: number) => (points.length === 1 ? 0.5 : i / (points.length - 1));
  const yf = (c: number) => 1 - (c - lo) / (hi - lo);
  const x = (i: number) => PAD_X + xf(i) * (W - 2 * PAD_X);
  const y = (c: number) => PAD_Y + yf(c) * (H - 2 * PAD_Y);
  const line = points.map((d, i) => `${x(i).toFixed(1)},${y(d.cents).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${H} ${line} ${x(points.length - 1).toFixed(1)},${H}`;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const focus = hover === null ? last : points[hover]!;
  const change = focus.cents - first.cents;
  const changePct = first.cents ? (change / first.cents) * 100 : 0;
  const up = change > 0;
  const flat = change === 0;
  const trendClass = flat ? "text-muted" : up ? "text-emerald-400" : "text-rose-400";
  const gridLines = [lo, (lo + hi) / 2, hi];

  const pick = (clientX: number) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left - PAD_X * (r.width / W)) / (r.width * (1 - (2 * PAD_X) / W))));
    setHover(Math.round(f * (points.length - 1)));
  };

  return (
    <section className={`flex flex-col rounded-xl border border-border bg-surface p-4 ${compact ? "h-full" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex gap-1" role="group" aria-label="Range">
          {windows.map((w) => {
            const ok = w.points.length >= 2;
            const on = w.key === range;
            return (
              <button
                key={w.key}
                type="button"
                disabled={!ok}
                aria-pressed={on}
                title={ok ? undefined : "Not enough history yet"}
                onClick={() => ok && setRange(w.key)}
                className={`tabular rounded-md px-2 py-1 text-[11px] font-medium ${
                  on ? "bg-accent/15 text-foreground" : ok ? "text-muted hover:text-foreground" : "cursor-not-allowed text-muted/40"
                }`}
              >
                {w.key}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular text-2xl font-semibold">{money(focus.cents)}</span>
        <span className={`tabular text-sm ${trendClass}`}>
          {flat ? "no change" : `${up ? "▲" : "▼"} ${money(Math.abs(change))} (${up ? "+" : "-"}${Math.abs(changePct).toFixed(1)}%)`}
        </span>
        <span className="tabular text-xs text-muted">
          {hover === null ? `${fmtDate(first.date)} → ${fmtDate(last.date)}` : `${fmtDate(focus.date)} · vs ${fmtDate(first.date)}`}
        </span>
        <span className="tabular ml-auto text-xs text-muted">
          {points.length} days · range {money(min)}–{money(max)}
        </span>
      </div>

      <div
        ref={boxRef}
        className={`relative mt-3 w-full select-none touch-pan-y ${compact ? "h-40 lg:h-28 lg:flex-1" : "h-40"}`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Price from ${money(first.cents)} on ${first.date} to ${money(last.cents)} on ${last.date}`}
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="ph-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridLines.map((g) => (
            <line
              key={g}
              x1={0}
              x2={W}
              y1={y(g)}
              y2={y(g)}
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeDasharray="3 5"
              vectorEffect="non-scaling-stroke"
              className="text-foreground"
            />
          ))}
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
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={0}
              y2={H}
              stroke="currentColor"
              strokeOpacity={0.5}
              vectorEffect="non-scaling-stroke"
              className="text-foreground"
            />
          )}
        </svg>

        {/* Gridline labels and the markers live in HTML so the stretched SVG
            can't distort them. */}
        {gridLines.map((g) => (
          <span
            key={g}
            className="tabular pointer-events-none absolute right-1 -translate-y-1/2 text-[10px] text-muted"
            style={{ top: `${(y(g) / H) * 100}%` }}
          >
            {money(Math.round(g))}
          </span>
        ))}
        <span
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
          style={{ left: `${(x(hover ?? points.length - 1) / W) * 100}%`, top: `${(y(focus.cents) / H) * 100}%` }}
        />
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] shadow-lg"
            style={
              xf(hover) > 0.6
                ? { right: `${100 - (x(hover) / W) * 100 + 1.5}%` }
                : { left: `${(x(hover) / W) * 100 + 1.5}%` }
            }
          >
            <div className="tabular font-semibold text-foreground">{money(focus.cents)}</div>
            <div className="tabular text-muted">{fmtDate(focus.date)}</div>
          </div>
        )}
      </div>

      <div className="tabular mt-1 flex justify-between text-[10px] text-muted">
        <span>{fmtDate(first.date, false)}</span>
        {points.length > 2 && <span>{fmtDate(points[Math.floor((points.length - 1) / 2)]!.date, false)}</span>}
        <span>{fmtDate(last.date, false)}</span>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {note} Scrub the chart for the exact price on a day.
      </p>
    </section>
  );
}
