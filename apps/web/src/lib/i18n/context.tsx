"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { isLocale, translate, type Locale, type StringKey } from "./strings";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate a UI string. Never applied to card, set or product names. */
  t: (key: StringKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "tcgroi.locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // English on the first render, server and client alike; the saved preference
  // is applied after hydration so the two never disagree.
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(saved)) {
        setLocaleState(saved);
        return;
      }
    } catch {
      // Blocked storage — fall through to the browser's preference.
    }
    // No stored choice: honour the browser, but only for languages we ship.
    const browser = navigator.language?.split("-")[0];
    if (isLocale(browser)) setLocaleState(browser);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Preference just won't persist.
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: (key: StringKey) => translate(locale, key) }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Safe outside a provider: falls back to English. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return { locale: "en", setLocale: () => {}, t: (key: StringKey) => translate("en", key) };
}
