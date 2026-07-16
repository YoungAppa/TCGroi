import { formatRoi } from "@packroi/ev/format";
import type { Confidence } from "@/lib/pullrates/schema";

/**
 * ROI coloured on a green->red ramp. Colour is reserved for ROI site-wide so
 * it always means the same thing.
 */
export function RoiCell({ roi }: { roi: number | null }) {
  if (roi === null) {
    return <span className="text-muted">—</span>;
  }
  // Gradient: >= 0 green; 0 to -50% amber-to-red; below -50% full red.
  const color =
    roi >= 0
      ? "text-roi-pos"
      : roi >= -0.25
        ? "text-amber-400"
        : roi >= -0.5
          ? "text-orange-400"
          : "text-roi-neg";
  return <span className={`font-semibold ${color}`}>{formatRoi(roi)}</span>;
}

const CONFIDENCE_STYLE: Record<Confidence, { label: string; cls: string; title: string }> = {
  high: {
    label: "HIGH",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    title: "Disclosed sample of 500+ packs",
  },
  medium: {
    label: "MEDIUM",
    cls: "border-sky-500/40 bg-sky-500/10 text-sky-400",
    title: "Disclosed sample of 100+ packs",
  },
  low: {
    label: "LOW",
    cls: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    title: "Small or undisclosed sample — treat as directional",
  },
  placeholder: {
    label: "PLACEHOLDER",
    cls: "border-red-500/40 bg-red-500/10 text-red-400",
    title: "No real data. These numbers are not meaningful.",
  },
};

/**
 * Always rendered wherever pull-rate-derived numbers appear — a non-negotiable
 * from the spec, not a styling choice.
 */
export function ConfidenceBadge({
  confidence,
  sampleSizePacks,
}: {
  confidence: Confidence;
  sampleSizePacks: number | null;
}) {
  const s = CONFIDENCE_STYLE[confidence];
  const sample =
    confidence === "placeholder"
      ? null
      : sampleSizePacks === null
        ? "n undisclosed"
        : `n=${sampleSizePacks.toLocaleString("en-US")}`;

  return (
    <span
      title={s.title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${s.cls}`}
    >
      {s.label}
      {sample && <span className="font-normal opacity-75">{sample}</span>}
    </span>
  );
}
