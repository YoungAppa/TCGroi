import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CardDetail } from "@/components/CardDetail";
import { getCardHistory } from "@/lib/data/cards";
import { gradingCost } from "@/lib/grading/fees";
import { rarityLabel } from "@/lib/catalog/rarities";
import { getCardContext } from "@/lib/data";
import { median } from "@packroi/ev";
import { formatCents, formatProbability } from "@packroi/ev/format";

// ISR like every data page. Card pages are NOT prerendered — the catalog holds
// ~100k cards and prerendering them would swamp the build — so they render on
// first request (a crawler's included) and then cache for an hour.
export const revalidate = 3600;

type Params = { game: string; setCode: string; number: string };

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://whatsthatroi.com";

function rawMedianCents(card: { raw: Record<string, number> }): number | null {
  return median(Object.values(card.raw));
}

/** "1 in 1,441 packs" — the phrase people actually search. */
function oneInPhrase(oneInPacks: number | null): string | null {
  return oneInPacks === null ? null : `1 in ${Math.round(oneInPacks).toLocaleString()} packs`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { game, setCode, number } = await params;
  const ctx = await getCardContext(game, setCode, decodeURIComponent(number));
  if (!ctx) return {};

  const price = rawMedianCents(ctx.card);
  const best = ctx.sources.find((s) => s.oneInPacks !== null);
  const odds = oneInPhrase(best?.oneInPacks ?? null);
  const rarity = rarityLabel(ctx.card.rarity);

  // Title carries the three things people type: card + number + set, then the
  // price, then the pull odds.
  const enBit = ctx.nameEn && ctx.nameEn !== ctx.card.name ? ` (${ctx.nameEn})` : "";
  const title =
    `${ctx.card.name}${enBit} ${ctx.card.number} ${ctx.setName} price` +
    (price !== null ? ` — ${formatCents(price)}` : "") +
    (odds ? `, ${odds}` : "");

  const description =
    `${ctx.card.name}${enBit} #${ctx.card.number} from ${ctx.setName} (${rarity})` +
    (price !== null ? ` is worth about ${formatCents(price)} raw` : "") +
    (odds ? `, and pulls at roughly ${odds}` : "") +
    `. See every ${ctx.setName} booster box, pack, ETB and tin that can contain it, ` +
    `with per-product odds, live market prices and PSA grading data.`;

  const canonical = `/${ctx.gameSlug}/${ctx.setCode}/card/${encodeURIComponent(ctx.card.number)}`;

  return {
    title,
    description,
    alternates: { canonical },
    keywords: [
      `${ctx.card.name} ${ctx.card.number}`,
      `${ctx.card.name} price`,
      `${ctx.card.name} ${ctx.setName}`,
      `${ctx.setName} ${rarity}`,
      `${ctx.card.name} pull rate`,
      `how much is ${ctx.card.name} worth`,
    ],
    openGraph: {
      type: "article",
      title,
      description,
      url: canonical,
      images: ctx.card.imageUrl ? [ctx.card.imageUrl] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ctx.card.imageUrl ? [ctx.card.imageUrl] : undefined,
    },
  };
}

export default async function CardPage({ params }: { params: Promise<Params> }) {
  const { game, setCode, number } = await params;
  const ctx = await getCardContext(game, setCode, decodeURIComponent(number));
  if (!ctx) notFound();
  // Daily raw-price snapshots have accumulated since the price cron began;
  // the same sparkline the product pages use.
  const history = await getCardHistory(ctx.card.cardId);

  const price = rawMedianCents(ctx.card);
  const psa10 = median(Object.values(ctx.card.psa10 ?? {}));
  const rarity = rarityLabel(ctx.card.rarity);
  const best = ctx.sources.find((s) => s.oneInPacks !== null);
  const odds = oneInPhrase(best?.oneInPacks ?? null);
  const cheapest = [...ctx.sources]
    .filter((s) => s.marketCents !== null && s.probPerProduct !== null && s.probPerProduct > 0)
    .sort((a, b) => a.marketCents! - b.marketCents!)[0];
  const bestChance = ctx.sources.find((s) => s.probPerProduct !== null && s.probPerProduct > 0);

  // "Is it worth grading?" — only where both legs exist; fee from the PSA tier
  // for the declared (graded) value, gem odds from the card's own census.
  const grading =
    price !== null && psa10 !== null
      ? (() => {
          const g = gradingCost(price, psa10);
          const net = psa10 - price - g.feeCents;
          const pop = ctx.card.population;
          const gemRate = pop && pop.total >= 50 ? pop.gemCount / pop.total : null;
          return { feeCents: g.feeCents, service: g.service, net, gemRate, popTotal: pop?.total ?? null };
        })()
      : null;

  // Price trend across everything we have tracked (no invented history).
  const trend =
    history.length >= 2
      ? {
          from: history[0]!,
          to: history[history.length - 1]!,
          pct: ((history[history.length - 1]!.cents - history[0]!.cents) / history[0]!.cents) * 100,
        }
      : null;

  const enBit2 = ctx.nameEn && ctx.nameEn !== ctx.card.name ? ` (${ctx.nameEn})` : "";

  // Breadcrumbs are the one structured-data type that is unambiguously honest
  // here: we are not selling the card, so no Offer/Product markup — claiming a
  // sale we don't make is exactly the kind of thing this site exists not to do.
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: ctx.gameName, item: SITE },
      {
        "@type": "ListItem",
        position: 2,
        name: ctx.setName,
        item: `${SITE}/${ctx.gameSlug}/${ctx.setCode}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `${ctx.card.name} #${ctx.card.number}`,
        item: `${SITE}/${ctx.gameSlug}/${ctx.setCode}/card/${encodeURIComponent(ctx.card.number)}`,
      },
    ],
  };

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      price !== null && {
        "@type": "Question",
        name: `How much is ${ctx.card.name}${enBit2} #${ctx.card.number} worth?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${ctx.card.name} #${ctx.card.number} from ${ctx.setName} is worth about ${formatCents(price)} raw at today's market prices${psa10 !== null ? `; a PSA 10 sells for about ${formatCents(psa10)}` : ""}.`,
        },
      },
      odds && {
        "@type": "Question",
        name: `What are the odds of pulling ${ctx.card.name}${enBit2}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Roughly ${odds}, assuming uniform odds within its rarity tier — community-measured rates, not official odds.`,
        },
      },
      grading && {
        "@type": "Question",
        name: `Is ${ctx.card.name}${enBit2} worth grading?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `A PSA 10 nets about ${grading.net > 0 ? "+" : ""}${formatCents(grading.net)} after the ${formatCents(grading.feeCents)} fee${grading.gemRate !== null ? `, and ${formatProbability(grading.gemRate)} of ${grading.popTotal!.toLocaleString()} graded copies came back a 10` : ""}.`,
        },
      },
    ].filter(Boolean),
  };

  return (
    <div className="space-y-6">
      <script
        type="application/ld+json"
        // Static, server-built object — no user input reaches it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      {faq.mainEntity.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
        />
      )}

      <nav aria-label="Breadcrumb" className="text-xs uppercase tracking-wide text-muted">
        <Link href="/" className="hover:text-foreground">
          {ctx.gameName}
        </Link>{" "}
        ·{" "}
        <Link href={`/${ctx.gameSlug}/${ctx.setCode}`} className="hover:text-foreground">
          {ctx.setName}
        </Link>{" "}
        · <span className="text-foreground">#{ctx.card.number}</span>
      </nav>

      <CardDetail ctx={ctx} history={history} />

      {/* ---- the indexable answer copy ----------------------------------- */}
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed">
        <h2 className="font-display text-lg font-bold">
          How much is {ctx.card.name} #{ctx.card.number} worth?
        </h2>
        <p>
          {ctx.card.name} <span className="text-muted">#{ctx.card.number}</span> is a{" "}
          <strong>{rarity}</strong> from the {ctx.gameName} set{" "}
          <Link href={`/${ctx.gameSlug}/${ctx.setCode}`} className="text-accent hover:underline">
            {ctx.setName}
          </Link>
          {price !== null ? (
            <>
              . Its current raw market value is <strong>{formatCents(price)}</strong>, blended
              from live eBay sold prices and TCGplayer market data
            </>
          ) : (
            <>. We do not yet have a live market price for this card</>
          )}
          {psa10 !== null && (
            <>
              , and a PSA 10 copy sells for about <strong>{formatCents(psa10)}</strong>
            </>
          )}
          .
        </p>

        <h2 className="font-display text-lg font-bold">
          What are the odds of pulling {ctx.card.name} #{ctx.card.number}?
        </h2>
        <p>
          {odds ? (
            <>
              You can expect to pull {ctx.card.name} roughly <strong>{odds}</strong>
              {ctx.tier && (
                <>
                  {" "}
                  — its {rarity} slot appears in about{" "}
                  {formatProbability(ctx.tier.perPackProbability)} of packs, shared across{" "}
                  {ctx.tier.cardsInTier} cards of that rarity in {ctx.setName}
                </>
              )}
              .{" "}
              {bestChance && bestChance.probPerProduct !== null && (
                <>
                  Opening a whole {bestChance.setName} {bestChance.productName} gives you about a{" "}
                  <strong>{formatProbability(bestChance.probPerProduct)}</strong> chance of pulling
                  at least one.
                </>
              )}
            </>
          ) : (
            <>
              This card sits outside the rarity tiers our pull-rate table enumerates for{" "}
              {ctx.setName}, so we do not publish per-pack odds for it rather than invent a
              number.
            </>
          )}
        </p>

        <h2 className="font-display text-lg font-bold">
          Which {ctx.setName} product should you open for it?
        </h2>
        <p>
          {cheapest ? (
            <>
              Every product in the table above draws from the same {ctx.setName} pack pool, so the
              honest answer is whichever costs least per pack — currently the{" "}
              <Link
                href={`/${ctx.gameSlug}/${cheapest.setCode}/${cheapest.productSlug}`}
                className="text-accent hover:underline"
              >
                {cheapest.setName} {cheapest.productName}
              </Link>{" "}
              at {formatCents(cheapest.marketCents!)}. Bear in mind that on our numbers nearly
              every sealed {ctx.gameName} product returns less than it costs when opened: buying
              the single outright is usually cheaper than chasing it.
            </>
          ) : (
            <>
              We do not have live sealed prices for {ctx.setName} products right now, so we
              can&apos;t say which is the cheapest route to this card.
            </>
          )}
        </p>
        {grading && (
          <>
            <h2 className="font-display text-lg font-bold">
              Is {ctx.card.name}{enBit2} worth grading?
            </h2>
            <p>
              A PSA 10 copy sells for about <strong>{formatCents(psa10!)}</strong> against a raw
              price of {formatCents(price!)} and a PSA fee of roughly {formatCents(grading.feeCents)}{" "}
              ({grading.service}) — so a 10 nets about{" "}
              <strong>{grading.net > 0 ? "+" : ""}{formatCents(grading.net)}</strong>.{" "}
              {grading.gemRate !== null ? (
                <>
                  Of the <strong>{grading.popTotal!.toLocaleString()}</strong> copies PSA has graded,{" "}
                  <strong>{formatProbability(grading.gemRate)}</strong> came back a 10 — and since
                  people submit their cleanest copies, read that as a ceiling for a random pull, not
                  your odds.
                </>
              ) : (
                <>
                  Too few copies have been graded for a reliable gem rate, so the payoff above is an
                  upper bound with unknown odds.
                </>
              )}
            </p>
          </>
        )}

        {trend && (
          <>
            <h2 className="font-display text-lg font-bold">
              {ctx.card.name}{enBit2} price history
            </h2>
            <p>
              Since we began tracking on <strong>{trend.from.date}</strong>, {ctx.card.name} has
              moved from {formatCents(trend.from.cents)} to{" "}
              <strong>{formatCents(trend.to.cents)}</strong> (
              {trend.pct >= 0 ? "+" : ""}
              {trend.pct.toFixed(1)}%). The chart above shows every tracked day; history deepens
              daily and nothing earlier is invented.
            </p>
          </>
        )}
      </section>

      {/* ---- internal links: the set's other chases ---------------------- */}
      {ctx.related.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">
            Other valuable cards in {ctx.setName}
          </h2>
          <div className="flex flex-wrap gap-2">
            {ctx.related.map((r) => (
              <Link
                key={r.number}
                href={`/${ctx.gameSlug}/${ctx.setCode}/card/${encodeURIComponent(r.number)}`}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:border-accent/50 hover:text-accent"
              >
                <span className="font-medium">{r.name}</span>{" "}
                <span className="tabular text-muted">#{r.number}</span>{" "}
                <span className="tabular">{formatCents(r.valueCents)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
