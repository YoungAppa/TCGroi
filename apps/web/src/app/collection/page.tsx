"use client";

/* eslint-disable @next/next/no-img-element -- external card art, plain img is deliberate */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Sparkline } from "@/components/Sparkline";
import { formatCents, formatRoi } from "@packroi/ev/format";

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

interface Holding {
  id: string;
  name: string;
  setCode: string;
  game: string;
  imageUrl: string | null;
  qty: number;
  paidCents: number | null;
  valueCents: number | null;
}

interface HistoryPoint {
  date: string;
  cents: number;
}

const KEY_COLLECTION = "tcgroi:collection:v1";
const KEY_WISHLIST = "tcgroi:wishlist:v1";

function loadList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveList<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota */
  }
}

type GameFilter = "all" | "one-piece" | "pokemon" | "mtg";
type SortKey = "value-desc" | "value-asc" | "gain-desc" | "name" | "set";
type Tab = "collection" | "wishlist";

const SORTS: Record<SortKey, (a: Holding, b: Holding) => number> = {
  "value-desc": (a, b) => (b.valueCents ?? 0) * b.qty - (a.valueCents ?? 0) * a.qty,
  "value-asc": (a, b) => (a.valueCents ?? 0) * a.qty - (b.valueCents ?? 0) * b.qty,
  "gain-desc": (a, b) => gainOf(b) - gainOf(a),
  name: (a, b) => a.name.localeCompare(b.name),
  set: (a, b) => a.setCode.localeCompare(b.setCode),
};
function gainOf(h: Holding): number {
  return h.paidCents !== null && h.valueCents !== null ? (h.valueCents - h.paidCents) * h.qty : 0;
}

export default function CollectionPage() {
  const [tab, setTab] = useState<Tab>("collection");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [wishlist, setWishlist] = useState<Holding[]>([]);
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState<GameFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("value-desc");
  const [portfolio, setPortfolio] = useState<HistoryPoint[]>([]);

  // Hydrate from localStorage, then refresh current values from the server.
  useEffect(() => {
    const c = loadList<Holding>(KEY_COLLECTION);
    const w = loadList<Holding>(KEY_WISHLIST);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHoldings(c);
    setWishlist(w);
    setReady(true);
    const ids = [...new Set([...c, ...w].map((h) => h.id))];
    if (ids.length === 0) return;
    (async () => {
      try {
        const res = await fetch("/api/cards/prices", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const { prices } = (await res.json()) as { prices: Record<string, number> };
        const apply = (list: Holding[]) => list.map((h) => ({ ...h, valueCents: prices[h.id] ?? h.valueCents }));
        setHoldings(apply);
        setWishlist(apply);
      } catch {
        /* keep stored */
      }
    })();
  }, []);

  useEffect(() => {
    if (ready) saveList(KEY_COLLECTION, holdings);
  }, [holdings, ready]);
  useEffect(() => {
    if (ready) saveList(KEY_WISHLIST, wishlist);
  }, [wishlist, ready]);

  // Portfolio value over time, refreshed when holdings change.
  useEffect(() => {
    if (!ready || holdings.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPortfolio([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/collection/history", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ holdings: holdings.map((h) => ({ cardId: h.id, qty: h.qty })) }),
        });
        const { history } = (await res.json()) as { history: HistoryPoint[] };
        setPortfolio(history ?? []);
      } catch {
        setPortfolio([]);
      }
    })();
  }, [holdings, ready]);

  const list = tab === "collection" ? holdings : wishlist;
  const setList = tab === "collection" ? setHoldings : setWishlist;

  const update = useCallback(
    (id: string, patch: Partial<Holding>) => setList((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h))),
    [setList],
  );
  const remove = useCallback((id: string) => setList((prev) => prev.filter((h) => h.id !== id)), [setList]);
  const add = useCallback(
    (c: CardHit) =>
      setList((prev) => {
        const existing = prev.find((h) => h.id === c.id);
        if (existing) return prev.map((h) => (h.id === c.id ? { ...h, qty: h.qty + 1 } : h));
        return [
          { id: c.id, name: c.name, setCode: c.setCode, game: c.game, imageUrl: c.imageUrl, qty: 1, paidCents: null, valueCents: c.priceCents },
          ...prev,
        ];
      }),
    [setList],
  );

  const filtered = useMemo(
    () => list.filter((h) => game === "all" || h.game === game).sort(SORTS[sortKey]),
    [list, game, sortKey],
  );

  const totals = useMemo(() => {
    let value = 0, cost = 0, costKnownValue = 0, gain = 0, cards = 0;
    for (const h of holdings) {
      value += (h.valueCents ?? 0) * h.qty;
      cards += h.qty;
      if (h.paidCents !== null) {
        cost += h.paidCents * h.qty;
        costKnownValue += (h.valueCents ?? 0) * h.qty;
      }
    }
    gain = costKnownValue - cost;
    return { value, cost, gain, roi: cost > 0 ? gain / cost : null, cards };
  }, [holdings]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My collection</h1>
        <p className="mt-1 text-sm text-muted">
          Search any card over $1, track live value and gain/loss, and watch your portfolio over
          time. Saved in this browser — no account needed.
        </p>
      </div>

      {/* Portfolio summary */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <Stat label="Cards held" value={totals.cards.toLocaleString("en-US")} />
        <Stat label="Current value" value={formatCents(totals.value)} />
        <Stat label="Cost basis" value={totals.cost > 0 ? formatCents(totals.cost) : "—"} />
        <Stat
          label="Gain / loss"
          value={totals.cost > 0 ? `${totals.gain >= 0 ? "+" : ""}${formatCents(totals.gain)}${totals.roi !== null ? `  (${formatRoi(totals.roi)})` : ""}` : "—"}
          tone={totals.cost > 0 ? (totals.gain >= 0 ? "pos" : "neg") : "default"}
        />
      </div>

      {/* Portfolio value chart */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">Portfolio value over time</h2>
        <Sparkline data={portfolio} emptyLabel="Your portfolio chart fills in as daily prices accumulate — add cards to begin." />
      </section>

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex items-end gap-1">
          {(["collection", "wishlist"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                tab === t ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t === "collection" ? `Collection (${holdings.length})` : `Wishlist (${wishlist.length})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-1 text-xs">
          <div className="flex gap-0.5 rounded-md bg-surface-raised p-0.5">
            {(["all", "one-piece", "pokemon", "mtg"] as GameFilter[]).map((g) => (
              <button
                key={g}
                onClick={() => setGame(g)}
                className={`rounded px-2.5 py-1 transition-colors ${game === g ? "bg-surface text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {g === "all" ? "All" : g === "one-piece" ? "One Piece" : g === "pokemon" ? "Pokémon" : "Magic"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-muted">
            Sort
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md bg-surface-raised px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
            >
              <option value="value-desc">Value (high)</option>
              <option value="value-asc">Value (low)</option>
              <option value="gain-desc">Biggest gain</option>
              <option value="name">Name</option>
              <option value="set">Set</option>
            </select>
          </label>
        </div>
      </div>

      <CardSearch onAdd={add} addLabel={tab === "collection" ? "Add" : "Wish"} />

      {ready && filtered.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          {list.length === 0
            ? tab === "collection"
              ? "Nothing yet — search above and add the cards you own."
              : "No wishlist cards yet — search and tap Wish."
            : "No cards in this section."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full min-w-[42rem] text-sm">
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
              {filtered.map((h) => (
                <Row key={h.id} h={h} onUpdate={update} onRemove={remove} wishlist={tab === "wishlist"} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "pos" | "neg" }) {
  const color = tone === "pos" ? "text-roi-pos" : tone === "neg" ? "text-roi-neg" : "text-foreground";
  return (
    <div className="bg-surface px-4 py-3">
      <div className={`tabular text-xl font-bold leading-none ${color}`}>{value}</div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function Row({
  h,
  onUpdate,
  onRemove,
  wishlist,
}: {
  h: Holding;
  onUpdate: (id: string, patch: Partial<Holding>) => void;
  onRemove: (id: string) => void;
  wishlist: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const gainEa = h.paidCents !== null && h.valueCents !== null ? h.valueCents - h.paidCents : null;

  useEffect(() => {
    if (!open || history !== null) return;
    (async () => {
      try {
        const res = await fetch(`/api/cards/history?id=${encodeURIComponent(h.id)}`);
        const { history } = (await res.json()) as { history: HistoryPoint[] };
        setHistory(history ?? []);
      } catch {
        setHistory([]);
      }
    })();
  }, [open, history, h.id]);

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-surface">
        <td className="px-3 py-2">
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left">
            {h.imageUrl && <img src={h.imageUrl} alt="" loading="lazy" className="h-10 w-auto rounded-sm object-contain" />}
            <span>
              <span className="font-medium">{h.name}</span>{" "}
              <span className="tabular text-muted">({h.setCode})</span>
              <span className="ml-1 text-[10px] text-muted">{open ? "▲" : "▼ chart"}</span>
            </span>
          </button>
        </td>
        <td className="px-3 py-2">
          <input
            type="number"
            min={1}
            value={h.qty}
            onChange={(e) => onUpdate(h.id, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            className="tabular w-14 rounded-md bg-surface-raised px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/40"
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
            className="tabular w-20 rounded-md bg-surface-raised px-2 py-1 placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
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
          <button onClick={() => onRemove(h.id)} className="text-xs text-muted underline hover:text-roi-neg">
            {wishlist ? "remove" : "remove"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/50 bg-surface/50">
          <td colSpan={6} className="px-4 py-3">
            <div className="text-xs font-medium text-muted">{h.name} — price history</div>
            {history === null ? (
              <p className="py-4 text-center text-xs text-muted">Loading…</p>
            ) : (
              <Sparkline data={history} height={120} emptyLabel="No price history recorded for this card yet." />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function CardSearch({ onAdd, addLabel }: { onAdd: (c: CardHit) => void; addLabel: string }) {
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
              title={`${addLabel} ${c.name}`}
            >
              <div className="relative flex h-28 items-center justify-center rounded bg-surface-raised/40">
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt={c.name} loading="lazy" className="h-full w-auto object-contain" />
                ) : (
                  <span className="px-1 text-center text-[10px] text-muted">no image</span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-xs font-semibold text-accent opacity-0 transition group-hover:opacity-100">
                  + {addLabel}
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
