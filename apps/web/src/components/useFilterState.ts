"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_FILTER_STATE,
  parseFilterState,
  serializeFilterState,
  type FilterState,
} from "@packroi/ev/url-state";

/**
 * The source-filter state. The URL is the single source of truth for CHANGES
 * (?src=&blend=&mode=) so every view stays a shareable link — but the state is
 * deliberately NOT read via useSearchParams.
 *
 * Why: useSearchParams suspends during static prerender, which would strip
 * the entire EV table out of the built HTML and serve crawlers an empty
 * shell (observed: the SSG product page contained no rankings, no badges, no
 * chase table). Instead the server renders the DEFAULT state — the exact
 * state the SEO title is computed from — and the client adopts the URL's
 * state after hydration. A shared link shows defaults for one frame, then
 * applies; a crawler sees the full default view.
 */
export function useFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setStateInternal] = useState<FilterState>(DEFAULT_FILTER_STATE);

  // Adopt the URL's state after hydration, and track back/forward.
  useEffect(() => {
    const read = () =>
      setStateInternal(parseFilterState(new URLSearchParams(window.location.search)));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const setState = useCallback(
    (next: FilterState) => {
      setStateInternal(next);
      // replace, not push: toggling a source is a view change, and stacking
      // ten history entries makes Back useless.
      router.replace(`${pathname}${serializeFilterState(next)}`, { scroll: false });
    },
    [router, pathname],
  );

  /** Appends the current filter to an internal href so it survives clicks. */
  const withFilter = useCallback(
    (href: string) => `${href}${serializeFilterState(state)}`,
    [state],
  );

  return { state, setState, withFilter };
}
