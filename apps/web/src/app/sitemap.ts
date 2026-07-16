import type { MetadataRoute } from "next";

import { getRankings } from "@/lib/data";

export const revalidate = 3600;

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://packroi.vercel.app";

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

  return [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/methodology`, changeFrequency: "monthly", priority: 0.5 },
    ...setUrls,
    ...productUrls,
  ];
}
