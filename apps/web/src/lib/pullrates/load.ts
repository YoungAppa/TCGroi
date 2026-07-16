import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parsePullRateFile, type PullRateFile } from "./schema";

/** Repo-root-relative home of the hand-maintained pull-rate data. */
export const PULLRATE_DIR = join(process.cwd(), "data", "pullrates");

export interface LoadedPullRate {
  file: PullRateFile;
  /** Path relative to the repo root, for error messages and admin display. */
  path: string;
}

/**
 * Reads and validates every pull-rate file on disk.
 *
 * Node-only (fs): called from the seed script, the refresh-catalog job, and
 * the data check — never from a rendered page.
 *
 * Throws on the first invalid file. That is deliberate: these files are the
 * one part of the system a human hand-writes, and a bad one produces a
 * plausible wrong number rather than a crash.
 */
export async function loadAllPullRates(dir = PULLRATE_DIR): Promise<LoadedPullRate[]> {
  const out: LoadedPullRate[] = [];

  let games: string[];
  try {
    games = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out; // No data directory yet — a valid state for a fresh checkout.
  }

  for (const game of games) {
    const gameDir = join(dir, game);
    const files = (await readdir(gameDir)).filter((f) => f.endsWith(".json"));

    for (const filename of files) {
      const full = join(gameDir, filename);
      const rel = `data/pullrates/${game}/${filename}`;
      const raw: unknown = JSON.parse(await readFile(full, "utf8"));
      const file = parsePullRateFile(raw, rel);

      // The directory is part of the data: a pokemon table sitting in the
      // one-piece folder would validate against the wrong rarity vocabulary.
      if (file.game !== game) {
        throw new Error(
          `${rel}: declares game "${file.game}" but lives in the "${game}" directory.`,
        );
      }

      const expected = `${file.setCode}.json`;
      if (filename !== expected) {
        throw new Error(
          `${rel}: declares setCode "${file.setCode}" so it must be named ${expected}.`,
        );
      }

      out.push({ file, path: rel });
    }
  }

  return out;
}

/** Sets with no real data yet — surfaced on the admin "needs data" page. */
export function needsData(loaded: LoadedPullRate[]): LoadedPullRate[] {
  return loaded.filter((l) => l.file.confidence === "placeholder");
}
