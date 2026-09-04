import type { MetadataRoute } from "next";

import { getRankings } from "@/lib/data";
import { median } from "@packroi/ev";

export const revalidate = 3600;

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://whatsthatroi.com";

/**
 * Cards below this raw value are left out of the sitemap on purpose. The
 * catalog holds ~51,000 unique cards, but a 5-cent common's page has nothing
 * to say — submitting thousands of near-empty pages is how a site earns a
 * thin-content reputation instead of rankings. The ~14,000 cards worth a
 * dollar or more are the ones people actually search for, and their pages
 * carry real prices, odds and grading data.
 */
const CARD_SITEMAP_MIN_CENTS = 100;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { products } = await getRankings();

  const productUrls = products.map((p) => ({
    url: `${BASE}/${p.gameSlug}/${p.setCode}/${p.productSlug}`,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const setUrls = [...new Set(products.map((p) => `${p.gameSlug}/${p.setCode}`))].map(
    (path) => ({
      url: `${BASE}/${path}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    }),
  );

  // One entry per card, deduped across the several products that share a set.
  const seen = new Set<string>();
  const cardUrls: MetadataRoute.Sitemap = [];
  for (const p of products) {
    for (const c of p.cards) {
      const key = `${p.gameSlug}/${p.setCode}/${c.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if ((median(Object.values(c.raw)) ?? 0) < CARD_SITEMAP_MIN_CENTS) continue;
      cardUrls.push({
        url: `${BASE}/${p.gameSlug}/${p.setCode}/card/${encodeURIComponent(c.number)}`,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      });
    }
  }

  return [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/methodology`, changeFrequency: "monthly", priority: 0.5 },
    ...setUrls,
    ...productUrls,
    ...cardUrls,
  ];
}
