"use client";

/* eslint-disable @next/next/no-img-element -- external card art, plain img is deliberate */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatCents } from "@packroi/ev/format";

interface CardHit {
  id: string;
  name: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  setCode: string;
  setName: string;
  game: string;
  priceCents: number | null;
}

/** A held card: the card's identity + what the user paid, plus a live value. */
interface Holding {
  id: string;
  name: string;
  setCode: string;
  game: string;
  imageUrl: string | null;
  qty: number;
  /** Cost basis per copy, cents. null = not entered. */
  paidCents: number | null;
  /** Latest value per copy, cents. Refreshed from the server on load. */
  valueCents: number | null;
}

const STORAGE_KEY = "tcgroi:collection:v1";

function load(): Holding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function save(holdings: Holding[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
  } catch {
    /* quota — ignore */
  }
}

export default function CollectionPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [ready, setReady] = useState(false);

  // Load from localStorage, then refresh current values from the server. The
  // synchronous hydrate is intentional: localStorage is a client-only source,
  // so the first paint must be empty (SSR-safe) and this fills it on mount.
  useEffect(() => {
    const initial = load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHoldings(initial);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    if (initial.length === 0) return;
    (async () => {
      try {
        const res = await fetch("/api/cards/prices", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: initial.map((h) => h.id) }),
        });
        const { prices } = (await res.json()) as { prices: Record<string, number> };
        setHoldings((prev) =>
          prev.map((h) => ({ ...h, valueCents: prices[h.id] ?? h.valueCents })),
        );
      } catch {
        /* keep stored values */
      }
    })();
  }, []);

  // Persist on every change (after the initial load).
  useEffect(() => {
    if (ready) save(holdings);
  }, [holdings, ready]);

  const update = useCallback((id: string, patch: Partial<Holding>) => {
    setHoldings((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }, []);

  const addCard = useCallback((c: CardHit) => {
    setHoldings((prev) => {
      const existing = prev.find((h) => h.id === c.id);
      if (existing) return prev.map((h) => (h.id === c.id ? { ...h, qty: h.qty + 1 } : h));
      return [
        {
          id: c.id,
          name: c.name,
          setCode: c.setCode,
          game: c.game,
          imageUrl: c.imageUrl,
          qty: 1,
          paidCents: null,
          valueCents: c.priceCents,
        },
        ...prev,
      ];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const totals = useMemo(() => {
    let value = 0;
    let cost = 0;
    let costKnown = 0;
    for (const h of holdings) {
      value += (h.valueCents ?? 0) * h.qty;
      if (h.paidCents !== null) {
        cost += h.paidCents * h.qty;
        costKnown += (h.valueCents ?? 0) * h.qty;
      }
    }
    const cards = holdings.reduce((s, h) => s + h.qty, 0);
    return { value, cost, costKnown, gain: costKnown - cost, cards };
  }, [holdings]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My collection</h1>
        <p className="mt-1 text-sm text-muted">
          Search any card worth over $1, add what you own, and track its live value.
          Your collection is saved in this browser — no account needed.
        </p>
      </div>

      {/* Portfolio summary */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <Stat label="Cards held" value={totals.cards.toLocaleString("en-US")} />
        <Stat label="Current value" value={formatCents(totals.value)} />
        <Stat label="Cost basis" value={totals.cost > 0 ? formatCents(totals.cost) : "—"} />
        <Stat
          label="Gain / loss"
          value={totals.cost > 0 ? formatCents(totals.gain) : "—"}
          tone={totals.cost > 0 ? (totals.gain >= 0 ? "pos" : "neg") : "default"}
          sign={totals.cost > 0}
        />
      </div>

      <CardSearch onAdd={addCard} />

      {/* Holdings */}
      {ready && holdings.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          Nothing yet — search above and add the cards you own.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Card</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Paid (ea)</th>
                <th className="px-3 py-2 font-medium">Value (ea)</th>
                <th className="px-3 py-2 font-medium">Gain / loss</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <HoldingRow key={h.id} h={h} onUpdate={update} onRemove={remove} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  sign = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "pos" | "neg";
  sign?: boolean;
}) {
  const color = tone === "pos" ? "text-roi-pos" : tone === "neg" ? "text-roi-neg" : "text-foreground";
  return (
    <div className="bg-surface px-4 py-3">
      <div className={`tabular text-xl font-bold leading-none ${color}`}>
        {sign && tone === "pos" ? "+" : ""}
        {value}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function HoldingRow({
  h,
  onUpdate,
  onRemove,
}: {
  h: Holding;
  onUpdate: (id: string, patch: Partial<Holding>) => void;
  onRemove: (id: string) => void;
}) {
  const gainEa = h.paidCents !== null && h.valueCents !== null ? h.valueCents - h.paidCents : null;
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-surface">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {h.imageUrl && (
            <img src={h.imageUrl} alt="" loading="lazy" className="h-10 w-auto rounded-sm object-contain" />
          )}
          <span>
            <span className="font-medium">{h.name}</span>{" "}
            <span className="tabular text-muted">({h.setCode})</span>
          </span>
        </div>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={1}
          value={h.qty}
          onChange={(e) => onUpdate(h.id, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          className="tabular w-16 rounded-md bg-surface-raised px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          step="0.01"
          placeholder="—"
          value={h.paidCents !== null ? (h.paidCents / 100).toString() : ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            onUpdate(h.id, { paidCents: v === "" ? null : Math.round(Number(v) * 100) });
          }}
          className="tabular w-24 rounded-md bg-surface-raised px-2 py-1 placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </td>
      <td className="tabular px-3 py-2">{h.valueCents !== null ? formatCents(h.valueCents) : "—"}</td>
      <td className="tabular px-3 py-2">
        {gainEa === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className={gainEa >= 0 ? "text-roi-pos" : "text-roi-neg"}>
            {gainEa >= 0 ? "+" : ""}
            {formatCents(gainEa * h.qty)}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={() => onRemove(h.id)}
          className="text-xs text-muted underline hover:text-roi-neg"
          aria-label={`Remove ${h.name}`}
        >
          remove
        </button>
      </td>
    </tr>
  );
}

function CardSearch({ onAdd }: { onAdd: (c: CardHit) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardHit[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(q)}`);
        const { results } = (await res.json()) as { results: CardHit[] };
        setResults(results ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a card to add (e.g. Umbreon ex, Shanks manga)…"
        aria-label="Search cards"
        className="w-full max-w-lg rounded-md bg-surface-raised px-3 py-2 text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
      {loading && <p className="text-xs text-muted">Searching…</p>}
      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => onAdd(c)}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface p-2 text-left transition hover:border-accent/50"
              title={`Add ${c.name}`}
            >
              <div className="relative flex h-28 items-center justify-center rounded bg-surface-raised/40">
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt={c.name} loading="lazy" className="h-full w-auto object-contain" />
                ) : (
                  <span className="px-1 text-center text-[10px] text-muted">no image</span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-xs font-semibold text-accent opacity-0 transition group-hover:opacity-100">
                  + Add
                </span>
              </div>
              <div className="mt-1.5 truncate text-xs font-medium" title={c.name}>
                {c.name}
              </div>
              <div className="flex items-baseline justify-between gap-1">
                <span className="tabular text-[10px] uppercase text-muted">{c.setCode}</span>
                <span className="tabular text-xs font-semibold">
                  {c.priceCents !== null ? formatCents(c.priceCents) : "—"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
