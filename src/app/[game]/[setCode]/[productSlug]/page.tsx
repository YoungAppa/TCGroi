import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductDetail } from "@/components/ProductDetail";
import { getProduct, getRankings } from "@/lib/data";
import { computeForPayload } from "@/lib/data/compute";
import { formatCents, formatRoi } from "@/lib/ev/format";
import { DEFAULT_FILTER_STATE } from "@/lib/ev/url-state";

// ISR alongside the rankings page.
export const revalidate = 3600;

type Params = { game: string; setCode: string; productSlug: string };

export async function generateStaticParams(): Promise<Params[]> {
  const { products } = await getRankings();
  return products.map((p) => ({
    game: p.gameSlug,
    setCode: p.setCode,
    productSlug: p.productSlug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { game, setCode, productSlug } = await params;
  const payload = await getProduct(game, setCode, productSlug);
  if (!payload) return {};

  // SEO title carries the default-state numbers, e.g.
  // "Surging Sparks Booster Box — EV $81.77, ROI −37.1%"
  const { availableSources } = await getRankings();
  const ev = computeForPayload(
    payload,
    DEFAULT_FILTER_STATE,
    availableSources.map((s) => s.id),
  );

  const title = `${payload.setName} ${payload.productName} — EV ${formatCents(ev.evProductCents)}${
    ev.roi !== null ? `, ROI ${formatRoi(ev.roi)}` : ""
  }`;

  return {
    title,
    description: `Expected value breakdown for ${payload.setName} ${payload.productName}: per-rarity EV, chase card odds, and pull-rate citations. Community estimates, not official odds.`,
  };
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { game, setCode, productSlug } = await params;
  const payload = await getProduct(game, setCode, productSlug);
  if (!payload) notFound();

  const { availableSources } = await getRankings();

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">
          {payload.gameName} · {payload.setCode}
          {payload.releaseDate ? ` · ${payload.releaseDate}` : ""}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          {payload.setName} — {payload.productName}
        </h1>
      </div>

      <ProductDetail payload={payload} availableSources={availableSources} />
    </div>
  );
}
