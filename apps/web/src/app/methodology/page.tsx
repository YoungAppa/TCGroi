import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How WhatsThatROI computes EV and ROI: data sources, the math, confidence levels, and the assumptions that carry real error.",
};

export const dynamic = "force-static";

/**
 * Plain-English and deliberately unflattering to our own numbers. Every
 * assumption that carries real error is named here, because a site whose
 * pitch is honesty cannot bury its own error bars.
 *
 * This page must track reality. It once promised that graded prices and PSA
 * population odds "are not in our data source yet, and we will not invent
 * them" — months after both had shipped. If a mechanic changes, change this
 * page in the same commit.
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

      <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">The math</h2>
        <p>
          For each rarity tier in a set we compute the average market value of
          one card of that tier. Cards worth less than $0.50 count at a flat
          bulk value of $0.01 — you cannot actually sell a $0.30 card for
          $0.30. A pack&apos;s expected value is each tier&apos;s per-pack
          probability times that tier&apos;s average card value, summed. A
          product&apos;s EV is its pack EV times the number of packs, plus
          guaranteed extras (promo cards). ROI is EV divided by the
          product&apos;s price, minus one.
        </p>
        <p className="text-muted">
          A card no selected price source covers is <em>excluded</em> from its
          tier average, never counted as $0 — but the coverage gap is shown, and
          a thinly-priced tier is flagged with the direction of its error:
          price sources list the cards people search for, so a partly-priced
          tier usually reads <em>high</em>, not merely uncertain.
        </p>
        <p className="text-muted">
          <strong>&quot;Worth opening&quot; keys on market ROI alone.</strong>{" "}
          Retail ROI answers &quot;what if I found it at MSRP&quot; and is shown
          where MSRP is still a price someone could pay — a set in print, or one
          whose market hasn&apos;t run past twice its list price. An
          out-of-print set&apos;s MSRP is history, not a price, so we
          don&apos;t quote a return against it.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">Pull rates are estimates. All of them.</h2>
        <p>
          With one exception (below), TCG publishers do not publish odds. Every
          set&apos;s table carries a badge for the class of evidence behind its
          rates:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>OFFICIAL</strong> — publisher-printed odds. Rare: Chinese
            law compels disclosure, so Simplified-Chinese Gem Packs anchor to
            their printed ★★★ rate.
          </li>
          <li>
            <strong>HIGH</strong> — a primary measured study with a disclosed
            sample: someone opened thousands of packs and published per-rarity
            counts. TCGplayer&apos;s Authentication Center studies (up to
            8,500+ packs) are the archetype.
          </li>
          <li>
            <strong>MEDIUM</strong> — a large tally with a stated sample that we
            cannot independently audit: community counts of opening videos
            (Sun &amp; Moon base, n=7,020 packs) or Japanese shops&apos;
            aggregated box openings (600–2,000 boxes per set).
          </li>
          <li>
            <strong>LOW</strong> — no primary data exists. The number is our own
            structural model, and the set&apos;s source note says exactly what
            it rests on. Whole eras live here: XY, Black &amp; White,
            Diamond&nbsp;&amp;&nbsp;Pearl and WOTC have <em>no counted study
            anywhere we could find</em>, and their notes say so rather than
            citing folklore.
          </li>
          <li>
            <strong>PLACEHOLDER</strong> — no data at all. Hidden from rankings.
          </li>
        </ul>
        <p>
          Where sources disagree, we show the spread on the product page rather
          than silently picking a winner. Set-to-set variation is real — the
          same 8,000-pack methodology measured Evolving Skies&apos; secret tier
          at half the rate the community assumed for the era — so no set
          silently inherits another&apos;s rates, and a set whose rates are
          borrowed from a sibling says so in its note.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">Graded mode: what the PSA toggle really does</h2>
        <p>
          With <strong>Graded (PSA)</strong> on, cards above a $100 raw floor
          are valued as a grading expectation instead of their raw price:
          PSA&nbsp;10 price × the card&apos;s gem rate, plus PSA&nbsp;9 price ×
          its 9-rate, minus PSA&apos;s real fee.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>The odds are per-card, from PSA&apos;s own census.</strong>{" "}
            Each card&apos;s gem rate is the share of its graded population
            that came back a 10 (shown with its n in &quot;Is it worth
            grading?&quot;). A 2021 Umbreon VMAX alt gems ~69% of the time; a
            1999 Unlimited Charizard ~0.5%. Cards with under 50 slabs fall back
            to a stated assumption (45% / 35%). The census counts cards people{" "}
            <em>chose</em> to submit, so read every rate as a ceiling, not the
            odds for a random pull.
          </li>
          <li>
            <strong>Prices are cross-checked before use.</strong> A PSA 10 more
            than 12× its own PSA 9 is a fantasy asking price, not a market
            (the p90 of 5,400 real pairs is 12×; verified chases sit at 2–7×) —
            it is dropped and the card sells raw. Signed, error and non-USD
            slabs are ignored. Where a card has several printings, the graded
            price is matched to ours by raw price, and skipped if ambiguous.
          </li>
          <li>
            <strong>Graded mode is withheld from LOW-confidence sets</strong> —
            and the product page says so when it happens. Graded values run
            ~16× raw, which amplifies any error in a guessed pull rate by the
            same factor; on measured odds that&apos;s fine, on a guess it
            manufactures a verdict.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">Known assumptions that carry error</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Uniform within tier.</strong> Per-card odds divide a
            tier&apos;s probability evenly across its cards. Real sets
            short-print some cards — Evolving Skies&apos; Umbreon VMAX alt was
            measured near 1 in 2,000 packs, far rarer than a uniform tier
            implies — so the flat tier average <em>understates</em> headline
            chases, and a &quot;1 in N&quot; for a specific card can be off in
            either direction.
          </li>
          <li>
            <strong>Japanese guarantees are folded into the rates.</strong>{" "}
            Japanese per-box guarantees (1 SAR per High-Class box, 3 AR per
            box) are part of the tallies the rates come from; they are stated in
            each set&apos;s note rather than modelled as separate floors.
          </li>
          <li>
            <strong>Sealed prices are live where matched.</strong> A figure
            marked with an asterisk is a hand-tracked fallback with a source
            and date — directional, not live.
          </li>
          <li>
            <strong>Selling is not free.</strong> EV uses market prices; actual
            realisation after fees, shipping, and time is lower. Our EV is
            optimistic about your ability to sell.
          </li>
          <li>
            <strong>Currency is display-only.</strong> Everything is computed
            and stored in USD; the currency selector converts at the day&apos;s
            ECB reference rate for display. ROI is a ratio and never converts.
            If rates are unavailable, prices show in USD and say so.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">The games differ</h2>
        <p>
          Each game&apos;s numbers rest on a different evidence base — they are
          not apples-to-apples:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Pokémon (English).</strong> The best-evidenced corner of the
            site: recent Scarlet&nbsp;&amp;&nbsp;Violet sets and two
            Sword&nbsp;&amp;&nbsp;Shield sets carry measured studies of
            1,200–8,500 packs (HIGH); Sun&nbsp;&amp;&nbsp;Moon anchors to one
            7,020-pack tally (MEDIUM); XY and older are honest LOW — no primary
            data exists. Two raw price sources (TCGplayer Market via
            pokemontcg.io, eBay sold via PriceCharting), plus graded prices and
            PSA populations via Scrydex.
          </li>
          <li>
            <strong>Pokémon (Japanese).</strong> Rarities and prices come from
            the licensed Scrydex API — real Japanese tiers, USD prices. Odds
            come from Japanese shops&apos; aggregated box-opening tallies
            (600–2,000 boxes per set, MEDIUM). Set and card names stay in
            Japanese, never machine-translated.
          </li>
          <li>
            <strong>Pokémon (Simplified Chinese).</strong> Gem Packs anchor to
            the officially printed ★★★ odd — the only publisher-disclosed rate
            on the site. Only the ★★★ tier is priced into EV: the lower
            grades&apos; prices cluster on eBay listing minimums rather than
            tracking rarity, so counting them would inflate EV with money
            nobody can realise. Deliberately conservative.
          </li>
          <li>
            <strong>One Piece.</strong> Community-advertised per-box rates,
            usually without a disclosed sample (LOW). Card facts and raw prices
            come from the licensed Scrydex API plus PriceCharting&apos;s eBay
            sold; the Manga / Wanted Poster / SP printings are their own tiers
            because they run 10–100× the base card. Pack odds describe the one
            notable card in a pack, so they don&apos;t sum to 100%.
          </li>
          <li>
            <strong>Magic: The Gathering.</strong> Play and Collector boosters
            are modelled from set structure with honest tier rules (special
            treatments and serialized cards stay out of EV). Its odds are under
            active review — treat Magic&apos;s positives with extra
            skepticism.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">Price data</h2>
        <p>
          Card prices come from sources you can toggle and blend (median by
          default): <strong>TCGplayer Market</strong> (pokemontcg.io for
          English Pokémon, the licensed Scrydex API for Japanese Pokémon and
          One Piece) and <strong>eBay sold</strong> (PriceCharting).{" "}
          <strong>Graded</strong> PSA 10/9 prices come from Scrydex and
          PokemonPriceTracker. <strong>Sealed</strong> box / pack / ETB prices
          come from PriceCharting and Scrydex. Everything refreshes on a
          schedule and is read from our database; no external price API is
          called while you load a page. Each product page charts its market
          price over time from the daily snapshots.
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
          API, Scrydex, PriceCharting, and PokemonPriceTracker; exchange rates
          from the European Central Bank via Frankfurter. This product is not
          endorsed by or affiliated with any of them, nor with TCGplayer, eBay,
          PSA, The Pokémon Company, or Bandai.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
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
