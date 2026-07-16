"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  parseFilterState,
  serializeFilterState,
  type FilterState,
} from "@/lib/ev/url-state";

/**
 * The source-filter state, read from and written to the URL. URL-only by spec:
 * every view is a shareable link, and the filter survives navigation because
 * every internal link is built with `withFilter`.
 */
export function useFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parseFilterState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const setState = useCallback(
    (next: FilterState) => {
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
