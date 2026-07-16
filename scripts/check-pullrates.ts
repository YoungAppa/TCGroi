/**
 * Validates every pull-rate file and prints a coverage report.
 *
 * Runs in CI: these files are hand-written, and a typo'd rarity or a
 * mis-scaled probability yields a believable wrong EV rather than an error.
 * Cheap to check, expensive to miss.
 *
 *   npm run check:pullrates
 */
import { loadAllPullRates } from "@/lib/pullrates/load";

const BADGE: Record<string, string> = {
  high: "HIGH       ",
  medium: "MEDIUM     ",
  low: "LOW        ",
  placeholder: "PLACEHOLDER",
};

async function main() {
  const loaded = await loadAllPullRates();

  if (loaded.length === 0) {
    console.log("No pull-rate files found.");
    return;
  }

  console.log(`Validated ${loaded.length} pull-rate file(s).\n`);

  const byGame = new Map<string, typeof loaded>();
  for (const l of loaded) {
    const bucket = byGame.get(l.file.game) ?? [];
    bucket.push(l);
    byGame.set(l.file.game, bucket);
  }

  for (const [game, files] of byGame) {
    console.log(`${game}:`);
    for (const { file } of files.sort((a, b) => a.file.setCode.localeCompare(b.file.setCode))) {
      const n =
        file.sampleSizePacks === null
          ? "sample undisclosed"
          : `n=${file.sampleSizePacks.toLocaleString("en-US")}`;
      console.log(
        `  ${BADGE[file.confidence]}  ${file.setCode.padEnd(10)} ${String(file.slots.length).padStart(2)} tiers  ${n}`,
      );
    }
    console.log();
  }

  const placeholders = loaded.filter((l) => l.file.confidence === "placeholder");
  const real = loaded.length - placeholders.length;
  console.log(`${real} set(s) with real cited data, ${placeholders.length} placeholder(s).`);
  if (placeholders.length > 0) {
    console.log(
      "Placeholders are hidden from public rankings unless showWhenPlaceholder is set.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`\nPull-rate validation FAILED:\n`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
