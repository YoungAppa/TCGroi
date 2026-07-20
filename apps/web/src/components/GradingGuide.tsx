import { gradingCost, PSA_FEES_AS_OF } from "@/lib/grading/fees";
import { formatCents } from "@packroi/ev/format";

interface ChaseLike {
  cardId: string;
  name: string;
  number: string;
  valueCents: number;
}

/**
 * "Is it worth grading?" for a product's chase cards. Honest about its limits:
 * PSA fees and the break-even are real, but we do NOT have graded (PSA 10)
 * sale prices or per-card PSA population odds, so this shows the threshold a
 * perfect 10 must clear — not a predicted profit. Cards below a few dollars
 * raw are never worth grading, so they're omitted.
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
        A graded PSA 10 has to sell for at least the <em>break-even</em> below to
        beat just selling the raw card — before the risk that it grades lower.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3">Card</th>
              <th className="py-1.5 pr-3">Raw</th>
              <th className="py-1.5 pr-3">PSA fee</th>
              <th className="py-1.5">Break-even (PSA 10)</th>
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
                  <td className="tabular py-1.5 font-medium">{formatCents(g.breakEvenCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">
        Graded (PSA 10/9) sale prices and per-card grade odds aren&apos;t in our
        data source yet — see methodology. Fees exclude shipping and are the
        cheapest PSA tier for each card&apos;s value.
      </p>
    </section>
  );
}
