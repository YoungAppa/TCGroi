import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parsePullRateFile, type PullRateFile } from "./schema";

/** Repo-root-relative home of the hand-maintained pull-rate data. */
export const PULLRATE_DIR = join(process.cwd(), "data", "pullrates");

export interface LoadedPullRate {
  file: PullRateFile;
  /**
   * Set language this table belongs to, from the directory layout: files in
   * `data/pullrates/<game>/` are English (default), files in a language
   * sub-folder `data/pullrates/<game>/<lang>/` carry that language (JP, ZH).
   * The set is resolved by (game, setCode, language) — a JP "SV3" and an EN
   * "sv3" are different sets, and their files can't collide on disk because
   * they live in different folders (which also dodges case-insensitive-FS
   * clashes like SV3.json vs sv3.json).
   */
  language: string;
  /** Path relative to the repo root, for error messages and admin display. */
  path: string;
}

/** Sub-folder name -> set_language value. Extend as more languages are added. */
const LANG_DIRS: Record<string, string> = { jp: "JP", zh: "ZH" };

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
    const entries = await readdir(gameDir, { withFileTypes: true });

    // English tables sit directly in the game folder.
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".json")) {
        await loadOne(out, game, "EN", gameDir, e.name, `data/pullrates/${game}/${e.name}`);
      }
    }
    // Non-English tables live in a language sub-folder (jp/, zh/).
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const language = LANG_DIRS[e.name];
      if (!language) {
        throw new Error(
          `data/pullrates/${game}/${e.name}: unknown language sub-folder — expected one of ${Object.keys(LANG_DIRS).join(", ")}.`,
        );
      }
      const subDir = join(gameDir, e.name);
      for (const f of (await readdir(subDir)).filter((f) => f.endsWith(".json"))) {
        await loadOne(out, game, language, subDir, f, `data/pullrates/${game}/${e.name}/${f}`);
      }
    }
  }

  return out;
}

/** Read, validate, and name-check one pull-rate file, appending to `out`. */
async function loadOne(
  out: LoadedPullRate[],
  game: string,
  language: string,
  fileDir: string,
  filename: string,
  rel: string,
): Promise<void> {
  const raw: unknown = JSON.parse(await readFile(join(fileDir, filename), "utf8"));
  const file = parsePullRateFile(raw, rel);

  // The directory is part of the data: a pokemon table sitting in the one-piece
  // folder would validate against the wrong rarity vocabulary.
  if (file.game !== game) {
    throw new Error(`${rel}: declares game "${file.game}" but lives in the "${game}" directory.`);
  }
  const expected = `${file.setCode}.json`;
  if (filename !== expected) {
    throw new Error(
      `${rel}: declares setCode "${file.setCode}" so it must be named ${expected}.`,
    );
  }
  out.push({ file, language, path: rel });
}

/** Sets with no real data yet — surfaced on the admin "needs data" page. */
export function needsData(loaded: LoadedPullRate[]): LoadedPullRate[] {
  return loaded.filter((l) => l.file.confidence === "placeholder");
}
