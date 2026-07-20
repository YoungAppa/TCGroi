import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PriceHistory } from "@/components/PriceHistory";
import { ProductDetail } from "@/components/ProductDetail";
import { getMarketHistory, getProduct, getRankings } from "@/lib/data";
import { computeProduct } from "@/lib/data/compute";
import { formatCents, formatRoi } from "@packroi/ev/format";
import { DEFAULT_FILTER_STATE } from "@packroi/ev/url-state";

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

  // SEO title carries the default-state numbers. Market ROI headlines when a
  // market price exists (it is the number people actually face); retail
  // otherwise.
  const { availableSources } = await getRankings();
  const { ev, roiRetail, roiMarket } = computeProduct(
    payload,
    DEFAULT_FILTER_STATE,
    availableSources.map((s) => s.id),
  );

  const roiPart =
    roiMarket !== null
      ? `, ROI ${formatRoi(roiMarket)} at market`
      : roiRetail !== null
        ? `, ROI ${formatRoi(roiRetail)} at MSRP`
        : "";
  const title = `${payload.setName} ${payload.productName} — EV ${formatCents(ev.evProductCents)}${roiPart}`;

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
  const history = await getMarketHistory(payload.productId);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">
          {payload.gameName} ·{" "}
          <Link
            href={`/${payload.gameSlug}/${payload.setCode}`}
            className="underline hover:text-foreground"
          >
            {payload.setCode}
          </Link>
          {payload.releaseDate ? ` · ${payload.releaseDate}` : ""}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          {payload.setName} — {payload.productName}
        </h1>
      </div>

      <ProductDetail payload={payload} availableSources={availableSources} />

      <PriceHistory data={history} />
    </div>
  );
}
