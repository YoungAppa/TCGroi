import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How TCGROI computes EV and ROI: data sources, the math, confidence levels, and the assumptions that carry real error.",
};

export const dynamic = "force-static";

/**
 * Plain-English and deliberately unflattering to our own numbers. Every
 * assumption that carries real error is named here, because a site whose
 * pitch is honesty cannot bury its own error bars.
 */
export default function MethodologyPage() {
  return (
    <article className="prose-sm mx-auto max-w-3xl space-y-6 leading-relaxed">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Methodology</h1>
        <p className="mt-2 text-muted">
          What the numbers mean, where they come from, and — most importantly —
          how wrong they can be.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">The math</h2>
        <p>
          For each rarity tier in a set we compute the average market value of
          one card of that tier. Cards worth less than $0.50 count at a flat
          bulk value of $0.01 — you cannot actually sell a $0.30 card for
          $0.30. A pack&apos;s expected value is each tier&apos;s
          per-pack probability times that tier&apos;s average card value,
          summed. A product&apos;s EV is its pack EV times the number of packs,
          plus guaranteed extras (promo cards, box guarantees). ROI is EV
          divided by the product&apos;s price, minus one.
        </p>
        <p className="text-muted">
          A card no selected price source covers is <em>excluded</em> from its
          tier average, never counted as $0 — but the coverage gap is shown, and
          a thinly-priced tier is flagged as an extrapolation.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Pull rates are estimates. All of them.</h2>
        <p>
          Pokémon and One Piece publishers do not publish odds. Every pull rate
          on this site comes from community pack-opening data, and each set&apos;s
          table carries a confidence badge:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>HIGH</strong> — the source disclosed a sample of 500+ packs
            with per-rarity counts.
          </li>
          <li>
            <strong>MEDIUM</strong> — disclosed sample of 100+ packs.
          </li>
          <li>
            <strong>LOW</strong> — small sample, or the source never disclosed
            one. Most published pull rates are in this bucket. Treat as
            directional.
          </li>
          <li>
            <strong>PLACEHOLDER</strong> — no real data. Hidden from rankings.
          </li>
        </ul>
        <p>
          Where sources disagree, we show the spread on the product page rather
          than silently picking a winner. Set-to-set variation is large — SV
          Base runs a Special Illustration Rare roughly every 33 packs, Surging
          Sparks roughly every 71–87 (yes, that range is the disagreement) — so
          no set inherits another&apos;s rates.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Known assumptions that carry error</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Uniform within tier.</strong> Per-card odds divide a
            tier&apos;s probability evenly across its cards. Real sets short-print
            some cards; no public dataset quantifies it. Our &quot;1 in N&quot;
            for a specific chase card can be meaningfully off in either
            direction.
          </li>
          <li>
            <strong>Sealed prices are live where matched.</strong> Box / ETB /
            pack market prices come from PriceCharting. A figure marked with an
            asterisk is a hand-tracked fallback for the few products without a
            live match — directional, not live.
          </li>
          <li>
            <strong>Grading is a break-even guide, not a graded EV.</strong> The
            product page shows PSA&apos;s real per-card grading fee and the
            break-even a PSA 10 must clear over the raw price. We do{" "}
            <em>not</em> predict graded profit: graded (PSA 10/9) sale prices
            and per-card PSA population odds are not in our data source yet, and
            we will not invent them.
          </li>
          <li>
            <strong>Selling is not free.</strong> EV uses market prices; actual
            realisation after fees, shipping, and time is lower. Our EV is
            optimistic about your ability to sell.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">The two games differ</h2>
        <p>
          Pokémon and One Piece are built and priced differently, so their
          numbers are not apples-to-apples:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Pokémon.</strong> Pull rates come from TCGplayer&apos;s
            Authentication Center studies, which disclose their sample (500 to
            8,500+ packs) — most Pokémon sets here rank HIGH confidence. A pack
            is ~10 cards and its hit rarities are spread across slots, so the
            odds sum to well under 100%; the tier table adds a{" "}
            <em>Bulk / regular cards</em> row for the rest of the pack. Two price
            sources are available (TCGplayer Market and eBay sold).
          </li>
          <li>
            <strong>One Piece.</strong> Pull rates come from community studies,
            usually without a disclosed sample, so most One Piece sets rank
            LOW–MEDIUM. Card facts come from optcgapi.com but its prices are
            ignored; the single price source is PriceCharting&apos;s eBay-sold
            data. A pack is 12 cards and its odds describe the roughly one
            notable card in it (Leader, SR, Alt Art, Manga, …), so they do{" "}
            <em>not</em> sum to 100% — the other ~11 cards are bulk. The Manga,
            Wanted Poster, and SP treatments are their own tiers, priced
            separately from the base card because they run 10–100× the price.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Price data</h2>
        <p>
          Card prices come from up to two sources you can toggle and blend:{" "}
          <strong>TCGplayer Market</strong> (via the pokemontcg.io mirror,
          Pokémon only) and <strong>eBay sold</strong> (via PriceCharting, both
          games). With more than one selected the number shown is a blend —
          median by default. Everything refreshes on a schedule and is read from
          our database; no external price API is ever called while you load a
          page.
        </p>
        <p className="text-muted">
          One Piece card facts come from optcgapi.com, whose scraped prices we
          deliberately ignore; One Piece prices come from PriceCharting&apos;s
          eBay-sold data instead — so One Piece now ranks with real EV.{" "}
          <strong>Sealed</strong> box / ETB / pack prices are also live from
          PriceCharting; a figure marked with an asterisk is a hand-tracked
          fallback for the few products without a live match. Each product page
          also charts its market price over time from the daily snapshots the
          price job accumulates.
        </p>
        <p className="text-muted">
          Card and price data via the{" "}
          <a
            href="https://pokemontcg.io"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            pokemontcg.io
          </a>{" "}
          API, PriceCharting, and PokemonPriceTracker. This product is not
          endorsed by or affiliated with any of them, nor with TCGplayer, eBay,
          PSA, The Pokémon Company, or Bandai.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What this site is not</h2>
        <p>
          Not financial advice, not gambling advice, not an inducement to open
          product. The recurring result across nearly every set is that opening
          sealed product returns substantially less than it costs. That is the
          finding, not the fine print.
        </p>
      </section>
    </article>
  );
}
