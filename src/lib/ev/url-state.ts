import type { BlendStrategy } from "./types";

/**
 * The source-filter state lives in the URL and nowhere else — no
 * localStorage, no cookies — so any view of the site is a shareable link that
 * reproduces exactly what the sharer saw. (Spec'd tradeoff: preferences reset
 * on a fresh visit.)
 *
 * Shape: ?src=a,b&blend=median&mode=graded
 * Everything has a default so a bare URL is valid, and defaults are OMITTED
 * when serialising so canonical URLs stay short and stable for SEO.
 */

export interface FilterState {
  /** Selected source ids. Empty array = "all enabled sources" (the default). */
  sources: string[];
  blend: BlendStrategy;
  graded: boolean;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  sources: [],
  blend: "median",
  graded: false,
};

const BLENDS: readonly BlendStrategy[] = ["median", "mean", "min", "max"];

export function parseFilterState(params: URLSearchParams): FilterState {
  const src = params.get("src");
  const sources = src
    ? src
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const blendRaw = params.get("blend");
  const blend = BLENDS.includes(blendRaw as BlendStrategy)
    ? (blendRaw as BlendStrategy)
    : "median";

  return {
    sources,
    blend,
    graded: params.get("mode") === "graded",
  };
}

/** Serialises, omitting defaults. Returns "" or "?..." ready to append. */
export function serializeFilterState(state: FilterState): string {
  const params = new URLSearchParams();
  if (state.sources.length > 0) params.set("src", state.sources.join(","));
  if (state.blend !== "median") params.set("blend", state.blend);
  if (state.graded) params.set("mode", "graded");
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * The sources to actually compute with: the URL's selection filtered to what
 * is really available, or everything available when nothing is selected.
 * An out-of-date share link naming a now-disabled source degrades gracefully
 * instead of rendering a page of unknowns.
 */
export function effectiveSources(state: FilterState, available: string[]): string[] {
  if (state.sources.length === 0) return available;
  const valid = state.sources.filter((s) => available.includes(s));
  return valid.length > 0 ? valid : available;
}
