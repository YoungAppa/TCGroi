"use client";

import { effectiveSources, type FilterState } from "@packroi/ev/url-state";
import type { BlendStrategy } from "@packroi/ev/types";

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
      // At least one source must stay on — deselecting the last is a no-op, not
      // a silent "reselect everything" (which read as a bug).
      if (next.length === 0) return;
    } else {
      next = [...selected, id];
    }
    // Everything selected is the default — store [] so the URL stays canonical.
    onChange({ ...state, sources: next.length === availableIds.length ? [] : next });
  }

  // The single remaining source can't be turned off; signal that on its pill.
  const lastOn = selected.length === 1;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted">Sources</span>
      {available.map((s) => {
        const on = selected.includes(s.id);
        const locked = on && lastOn;
        return (
          <button
            key={s.id}
            onClick={() => toggle(s.id)}
            aria-pressed={on}
            title={locked ? "At least one price source stays on" : undefined}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              on
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-surface-raised hover:text-foreground"
            } ${locked ? "cursor-default" : ""}`}
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
            className="rounded-md bg-surface-raised px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
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
