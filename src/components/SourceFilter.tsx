"use client";

import { effectiveSources, type FilterState } from "@/lib/ev/url-state";
import type { BlendStrategy } from "@/lib/ev/types";

/**
 * The skinsearch-style source pills + blend selector.
 *
 * Pills toggle sources; with several selected the numbers are a blend
 * (median by default). Purely presentational — the state lives in the URL via
 * useFilterState, and every EV on the page recomputes client-side on change.
 */
export function SourceFilter({
  available,
  state,
  onChange,
  gradedAvailable,
}: {
  available: { id: string; displayName: string }[];
  state: FilterState;
  onChange: (next: FilterState) => void;
  /** False hides the graded toggle entirely (no graded-capable source). */
  gradedAvailable: boolean;
}) {
  const availableIds = available.map((a) => a.id);
  const selected = effectiveSources(state, availableIds);

  function toggle(id: string) {
    const isOn = selected.includes(id);
    let next: string[];
    if (isOn) {
      next = selected.filter((s) => s !== id);
      // Deselecting the last source would mean "price nothing" — snap back to
      // all, which is what an empty selection already means.
      if (next.length === 0) next = [];
    } else {
      next = [...selected, id];
      // Selecting everything is the default — keep the URL canonical.
      if (next.length === availableIds.length) next = [];
    }
    onChange({ ...state, sources: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted">Sources</span>
      {available.map((s) => {
        const on = selected.includes(s.id);
        return (
          <button
            key={s.id}
            onClick={() => toggle(s.id)}
            aria-pressed={on}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              on
                ? "border-accent bg-accent/15 text-accent"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {s.displayName}
          </button>
        );
      })}

      {selected.length > 1 && (
        <label className="ml-2 flex items-center gap-1 text-xs text-muted">
          blend
          <select
            value={state.blend}
            onChange={(e) =>
              onChange({ ...state, blend: e.target.value as BlendStrategy })
            }
            className="rounded border border-border bg-surface px-1 py-0.5 text-xs"
          >
            <option value="median">median</option>
            <option value="mean">mean</option>
            <option value="min">min</option>
            <option value="max">max</option>
          </select>
        </label>
      )}

      {gradedAvailable && (
        <button
          onClick={() => onChange({ ...state, graded: !state.graded })}
          aria-pressed={state.graded}
          className={`ml-auto rounded-full border px-3 py-1 text-xs font-medium ${
            state.graded
              ? "border-accent bg-accent/15 text-accent"
              : "border-border bg-surface text-muted hover:text-foreground"
          }`}
        >
          Graded (PSA)
        </button>
      )}
    </div>
  );
}
