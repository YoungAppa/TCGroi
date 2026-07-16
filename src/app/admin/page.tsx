"use client";

import { useCallback, useState } from "react";

/**
 * Single-admin console behind ADMIN_SECRET.
 *
 * The page is a public shell; every byte of data arrives via
 * /api/admin/status with the secret in an Authorization header. The secret
 * lives in React state only — deliberately not in the URL (server logs) and
 * not in localStorage (this project's persistence rule is URL-or-nothing,
 * and a secret must never be in a URL).
 */

interface AdminStatus {
  adapters: {
    id: string;
    displayName: string;
    enabled: boolean;
    supports: { cardsRaw: boolean; cardsGraded: boolean; sealed: boolean };
  }[];
  counts: { snapshots: number; latest: number; cards: number };
  sets: {
    code: string;
    name: string;
    game: string;
    cardCount: number;
    confidence: string | null;
    sampleSizePacks: number | null;
    version: number | null;
  }[];
  needsData: { code: string; name: string; game: string }[];
  jobRuns: {
    id: string;
    job: string;
    status: string;
    startedAt: string;
    seconds: number | null;
    error: string | null;
    stats: Record<string, unknown>;
  }[];
}

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/status", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (res.status === 401) {
        setMessage("Wrong secret.");
        setStatus(null);
        return;
      }
      setStatus((await res.json()) as AdminStatus);
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [secret]);

  async function trigger(path: string, label: string) {
    setBusy(true);
    setMessage(`${label} running…`);
    try {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${secret}` } });
      const body = (await res.json()) as { ok?: boolean; stats?: unknown; error?: string };
      setMessage(
        body.ok ? `${label} done: ${JSON.stringify(body.stats)}` : `${label} FAILED: ${body.error}`,
      );
      await load();
    } catch (err) {
      setMessage(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Admin</h1>

      <div className="flex max-w-md gap-2">
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
          placeholder="ADMIN_SECRET"
          className="flex-1 rounded border border-border bg-surface px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => void load()}
          disabled={busy || secret.length === 0}
          className="rounded border border-accent bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent disabled:opacity-50"
        >
          Unlock
        </button>
      </div>

      {message && <p className="text-sm text-amber-400">{message}</p>}

      {status && (
        <>
          {/* ---- actions ---- */}
          <section className="flex flex-wrap gap-2">
            <button
              onClick={() => void trigger("/api/cron/refresh-prices", "refresh-prices")}
              disabled={busy}
              className="rounded border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-raised disabled:opacity-50"
            >
              Run refresh-prices
            </button>
            <button
              onClick={() => void trigger("/api/cron/refresh-catalog", "refresh-catalog")}
              disabled={busy}
              className="rounded border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-raised disabled:opacity-50"
            >
              Run refresh-catalog
            </button>
          </section>

          {/* ---- price sources ---- */}
          <section className="space-y-1">
            <h2 className="text-lg font-semibold">Price sources</h2>
            {status.adapters.every((a) => !a.enabled) && (
              <p className="text-sm text-amber-400">
                No price source configured — the site is showing MSRP-based
                placeholders. Connect one via env (TCGPLAYER_MIRROR_* or
                PRICECHARTING_TOKEN).
              </p>
            )}
            <ul className="space-y-1 text-sm">
              {status.adapters.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${a.enabled ? "bg-roi-pos" : "bg-border"}`}
                  />
                  <span className="w-44">{a.displayName}</span>
                  <span className="text-xs text-muted">
                    {a.enabled ? "enabled" : "disabled"} · raw:{String(a.supports.cardsRaw)} graded:
                    {String(a.supports.cardsGraded)} sealed:{String(a.supports.sealed)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              {status.counts.cards.toLocaleString("en-US")} cards ·{" "}
              {status.counts.latest.toLocaleString("en-US")} current prices ·{" "}
              {status.counts.snapshots.toLocaleString("en-US")} snapshots in history
            </p>
          </section>

          {/* ---- needs data ---- */}
          <section className="space-y-1">
            <h2 className="text-lg font-semibold">
              Sets needing pull-rate data ({status.needsData.length})
            </h2>
            <p className="text-xs text-muted">
              These sets are hidden from public rankings until a real,
              cited pull-rate file exists in data/pullrates/.
            </p>
            <div className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {status.needsData.map((s) => (
                <div key={`${s.game}-${s.code}`} className="rounded border border-border bg-surface px-2 py-1">
                  <span className="text-muted">{s.game}</span> {s.code} — {s.name}
                </div>
              ))}
            </div>
          </section>

          {/* ---- job runs ---- */}
          <section className="space-y-1">
            <h2 className="text-lg font-semibold">Job runs</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Took</th>
                    <th className="px-3 py-2">Stats / error</th>
                  </tr>
                </thead>
                <tbody>
                  {status.jobRuns.map((r) => (
                    <tr key={r.id} className="border-b border-border/40 align-top last:border-0">
                      <td className="px-3 py-1.5">{r.job}</td>
                      <td
                        className={`px-3 py-1.5 font-medium ${
                          r.status === "success"
                            ? "text-roi-pos"
                            : r.status === "failure"
                              ? "text-roi-neg"
                              : "text-amber-400"
                        }`}
                      >
                        {r.status}
                      </td>
                      <td className="tabular px-3 py-1.5 text-muted">
                        {new Date(r.startedAt).toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="tabular px-3 py-1.5">{r.seconds !== null ? `${r.seconds}s` : "—"}</td>
                      <td className="max-w-md px-3 py-1.5 text-xs text-muted">
                        {r.error ? (
                          <span className="text-roi-neg">{r.error.split("\n")[0]}</span>
                        ) : (
                          JSON.stringify(r.stats)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
