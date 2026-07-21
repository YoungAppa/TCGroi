import { gradingCost, PSA_FEES_AS_OF } from "@/lib/grading/fees";
import { formatCents } from "@packroi/ev/format";

interface ChaseLike {
  cardId: string;
  name: string;
  number: string;
  valueCents: number;
}

/**
 * "Is it worth grading?" for a product's chase cards.
 *
 * The finished view answers it directly: PSA 10 sale value vs the raw price plus
 * PSA's fee, weighted by the odds the card actually grades a 10. Two of those
 * three inputs aren't in our data yet — PSA 10 sale prices need a graded price
 * feed (the current PriceCharting tier returns ungraded only) and per-card
 * grade odds need PSA population data — so those columns render a pending "—"
 * and fill in the moment either source lands. The raw price and PSA fee are
 * real today. Cards below a few dollars raw are never worth grading, so they're
 * omitted.
 */
export function GradingGuide({ chase }: { chase: ChaseLike[] }) {
  const GRADEABLE_MIN = 1000; // $10 raw — below this a $25 fee never pays off
  const rows = chase.filter((c) => c.valueCents >= GRADEABLE_MIN).slice(0, 12);
  if (rows.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Is it worth grading?</h2>
        <span className="text-xs text-muted">PSA US fees, approx · {PSA_FEES_AS_OF}</span>
      </div>
      <p className="text-xs text-muted">
        What a PSA 10 sells for, the chance the card actually grades a 10, and
        PSA&apos;s fee — enough to tell whether grading beats just selling the raw
        card.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3">Card</th>
              <th className="py-1.5 pr-3">Raw</th>
              <th className="py-1.5 pr-3">PSA fee</th>
              <th className="py-1.5 pr-3">
                PSA 10 value <span className="text-[10px] normal-case">· soon</span>
              </th>
              <th className="py-1.5">
                Chance of PSA 10 <span className="text-[10px] normal-case">· soon</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const g = gradingCost(c.valueCents);
              return (
                <tr key={c.cardId} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-3">
                    {c.name} <span className="text-muted">#{c.number}</span>
                  </td>
                  <td className="tabular py-1.5 pr-3">{formatCents(c.valueCents)}</td>
                  <td className="tabular py-1.5 pr-3 text-muted">
                    {formatCents(g.feeCents)}{" "}
                    <span className="text-[11px]">({g.service})</span>
                  </td>
                  <td
                    className="tabular py-1.5 pr-3 text-muted/60"
                    title="PSA 10 sale price — pending a graded price source"
                  >
                    —
                  </td>
                  <td
                    className="tabular py-1.5 text-muted/60"
                    title="Odds this card grades a PSA 10 — pending PSA population data"
                  >
                    —
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">
        <span className="text-foreground">PSA 10 value</span> and{" "}
        <span className="text-foreground">Chance of PSA 10</span> are coming: the
        first needs a graded price feed (our current source returns ungraded
        prices only), the second needs PSA population reports. Both fill in
        automatically once connected — see methodology. Fees exclude shipping and
        are the cheapest PSA tier for each card&apos;s value.
      </p>
    </section>
  );
}
