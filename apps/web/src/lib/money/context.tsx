"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  formatMoney,
  isCurrencyCode,
  type CurrencyCode,
  type FxRates,
} from "./currencies";

interface MoneyContextValue {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  /** USD cents -> a formatted string in the selected currency. */
  money: (usdCents: number) => string;
  /** True when rates failed to load, so the UI can say prices are in USD. */
  ratesUnavailable: boolean;
}

const MoneyContext = createContext<MoneyContextValue | null>(null);

const STORAGE_KEY = "tcgroi.currency";

export function MoneyProvider({
  rates,
  children,
}: {
  rates: FxRates;
  children: React.ReactNode;
}) {
  // Always start on USD so the server and the first client render agree; the
  // stored preference is applied in an effect, after hydration.
  const [currency, setCurrencyState] = useState<CurrencyCode>("USD");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isCurrencyCode(saved)) setCurrencyState(saved);
    } catch {
      // Private browsing or blocked storage — the default is fine.
    }
  }, []);

  const setCurrency = useCallback((c: CurrencyCode) => {
    setCurrencyState(c);
    try {
      window.localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // Preference just won't persist; the session still works.
    }
  }, []);

  const value = useMemo<MoneyContextValue>(
    () => ({
      currency,
      setCurrency,
      money: (usdCents: number) => formatMoney(usdCents, currency, rates),
      ratesUnavailable: Object.keys(rates).length === 0,
    }),
    [currency, setCurrency, rates],
  );

  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

/**
 * Formats USD cents in the reader's currency.
 *
 * Safe outside a provider: it falls back to plain USD formatting, so a
 * component can be rendered in isolation (or in a test) without wiring one up.
 */
export function useMoney(): MoneyContextValue {
  const ctx = useContext(MoneyContext);
  if (ctx) return ctx;
  return {
    currency: "USD",
    setCurrency: () => {},
    money: (usdCents: number) => formatMoney(usdCents, "USD", {}),
    ratesUnavailable: false,
  };
}
