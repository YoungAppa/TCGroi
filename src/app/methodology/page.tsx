import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How PACKROI computes EV and ROI: data sources, the math, confidence levels, and the assumptions that carry real error.",
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
            <strong>Sealed placeholder prices.</strong> Where a sealed price is
            marked with an asterisk, it is hand-entered, not live. EV is live;
            that ROI is directional.
          </li>
          <li>
            <strong>Graded mode (when available)</strong> values submissions as
            PSA 10 × gem rate + PSA 9 × grade-9 rate − grading fee, and gives
            zero value to the ~20% grading 8 or below — so it understates
            graded EV. Conservative on purpose.
          </li>
          <li>
            <strong>Selling is not free.</strong> EV uses market prices; actual
            realisation after fees, shipping, and time is lower. Our EV is
            optimistic about your ability to sell.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Price data</h2>
        <p>
          Card prices are TCGplayer market prices obtained through a
          third-party mirror (currently pokemontcg.io), refreshed on a
          schedule — never scraped, and never fetched while you load a page.
          This product uses pokemontcg.io data but is not endorsed by or
          affiliated with pokemontcg.io, TCGplayer, or The Pokémon Company.
        </p>
        <p className="text-muted">
          One Piece card facts come from optcgapi.com; its prices are
          deliberately not used, and One Piece EV stays hidden until a licensed
          price source covers it.
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
