"use client";

import { useI18n } from "@/lib/i18n/context";

/** The rankings page's title and thesis line, in the reader's language. */
export function RankingsHeading() {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("rankings.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("rankings.subtitle")}</p>
    </div>
  );
}
