import type { CatalogSet } from "@/lib/catalog/types";
import { getEnv } from "@/lib/env";

import {
  PriceSourceError,
  toCents,
  type PriceSourceAdapter,
  type PriceSnapshotInput,
  type PriceableCard,
} from "../types";

/**
 * PriceCharting — eBay-sold prices, via the account's bulk price-guide CSV.
 *
 * Requires a paid subscription token. Absent => enabled() is false, the UI
 * hides the source, and One Piece (whose only price source this is) shows no
 * prices at all. The site must work in that state, and CI builds it that way.
 *
 * Why the CSV and not the /api/product endpoint: that endpoint is one HTTP call
 * per card keyed on a PriceCharting id we don't store, so pricing a 250-card
 * set is 250 calls against a quota — and every One Piece set at once is
 * thousands. The `download-custom` CSV returns the entire category
 * (id, console-name, product-name, loose-price) in a single request, which we
 * download once per run and index in memory. It carries only ungraded ("loose")
 * prices; graded (PSA 9/10) would need the per-card endpoint and is left for a
 * later graded-mode pass, so supports.cardsGraded is false.
 *
 * Matching (verified against live data before trusting it — see the recon in
 * the PR that introduced this):
 *   One Piece — product-name embeds the card code and treatment, e.g.
 *     "Shanks [Manga] OP09-004". We key on code + treatment because the same
 *     code spans a $2 base and a $1,600 Manga. English only ("... Japanese ..."
 *     consoles are a separate, unwanted printing).
 *   Pokémon — console-name is the set ("Pokemon Stellar Crown") and
 *     product-name ends in the collector number ("Squirtle #148"). We key on
 *     set + number, base printing only (bracketed rows are reverse-holo/variant
 *     re-listings we don't model).
 */
const BASE = "https://www.pricecharting.com/price-guide/download-custom";

/**
 * Treatment matching is the crux of One Piece: the same card code spans a $2
 * base and a $1,600 Manga, so a price must match the right printing. But the
 * two catalogs *name* treatments differently — optcgapi calls the ★ alt-art
 * "Parallel" while PriceCharting calls it "[Alternate Art]" — so both sides are
 * canonicalised to a shared slug before keying.
 */
const PC_BRACKET_TO_CANON: Record<string, string> = {
  "alternate art": "alt_art",
  parallel: "alt_art",
  manga: "manga",
  "wanted poster": "wanted_poster",
  "box topper": "box_topper",
  "treasure rare": "treasure_rare",
  sp: "sp",
};
/** Our card.treatment -> the same canonical slug PC_BRACKET_TO_CANON produces. */
const OUR_TREATMENT_TO_CANON: Record<string, string> = {
  parallel: "alt_art",
  treasure: "treasure_rare",
};
function canonTreatment(t: string): string {
  return OUR_TREATMENT_TO_CANON[t] ?? t;
}

/** set.code -> PriceCharting console-name, where "Pokemon <set.name>" is wrong. */
const PK_CONSOLE_OVERRIDE: Record<string, string> = {
  sv3pt5: "Pokemon Scarlet & Violet 151",
};

/**
 * Our sealed product-type -> candidate PriceCharting product-names, tried in
 * order. Most sets use the first; a few name the same product differently
 * (Scarlet & Violet base calls its box "Base Set Booster Box").
 */
const SEALED_LABELS: Record<string, string[]> = {
  booster_box: ["Booster Box", "Base Set Booster Box"],
  booster_pack: ["Booster Pack"],
  etb: ["Elite Trainer Box"],
  bundle: ["Booster Bundle"],
  case: ["Ultra Premium Collection Box"],
};

/** Everything parsed from one category CSV: card prices and sealed prices. */
type CategoryData = { cards: Map<string, number>; sealed: Map<string, number> };

const OP_CODE = /\b([A-Z]{1,3}\d{2}-\d{3})\b/;
const BRACKET = /\[([^\]]+)\]/;
const PK_NUMBER = /#\s*([A-Za-z0-9]+)\s*$/;

export class PriceChartingAdapter implements PriceSourceAdapter {
  readonly id = "pricecharting_ebay";
  readonly displayName = "eBay (sold)";
  readonly supports = { cardsRaw: true, cardsGraded: false, sealed: true };

  /** Parsed per-category data (card + sealed indexes), built once per run. */
  private opData?: Promise<CategoryData>;
  private pkData?: Promise<CategoryData>;

  private token(): string | undefined {
    return getEnv().PRICECHARTING_TOKEN;
  }

  enabled(): boolean {
    return this.token() !== undefined;
  }

  private assertToken(): string {
    const t = this.token();
    if (!t) {
      throw new PriceSourceError(
        "PRICECHARTING_TOKEN is not configured — callers must check enabled() first",
        this.id,
      );
    }
    return t;
  }

  /**
   * Download one category CSV. Job-time only — never a request path.
   *
   * These feeds are multi-MB, so a transient stall shouldn't sink the whole
   * run: retry with backoff. Per-attempt timeout stays well under the Vercel
   * cron cap (only two categories download per run, each memoised). A 4xx —
   * bad token, unknown category — is not retried.
   */
  private async downloadCsv(category: string): Promise<string> {
    const token = this.assertToken();
    const url = `${BASE}?t=${encodeURIComponent(token)}&category=${category}`;
    const RETRIES = 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          const err = new PriceSourceError(`HTTP ${res.status} downloading ${category} CSV`, this.id);
          if (res.status >= 400 && res.status < 500) throw err;
          lastErr = err;
          continue;
        }
        return await res.text();
      } catch (err) {
        if (err instanceof PriceSourceError && /HTTP 4\d\d/.test(err.message)) throw err;
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new PriceSourceError(
      `failed to download ${category} CSV after ${RETRIES + 1} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      this.id,
      { cause: lastErr },
    );
  }

  /**
   * Split a PriceCharting CSV line into its four columns. console-name has no
   * comma, and loose-price is the final column, so anything between is the
   * product-name — which keeps a rare comma in a card name from shifting fields.
   */
  private static splitRow(line: string): { console: string; product: string; cents: number } | null {
    const parts = line.split(",");
    if (parts.length < 4) return null;
    const consoleName = parts[1];
    const priceStr = parts[parts.length - 1];
    if (consoleName === undefined || priceStr === undefined) return null;
    const product = parts.slice(2, parts.length - 1).join(",");
    const dollars = parseFloat(priceStr.replace(/[$,]/g, ""));
    if (!Number.isFinite(dollars)) return null;
    return { console: consoleName, product, cents: toCents(dollars) };
  }

  private buildOpIndex(csv: string): Map<string, number> {
    const index = new Map<string, number>();
    const lines = csv.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const row = PriceChartingAdapter.splitRow(line);
      if (!row) continue;
      // English printings only.
      if (!row.console.startsWith("One Piece") || row.console.includes("Japanese")) continue;
      const code = row.product.match(OP_CODE)?.[1];
      if (!code) continue;
      const bracket = row.product.match(BRACKET)?.[1]?.toLowerCase();
      const treatment = bracket ? PC_BRACKET_TO_CANON[bracket] : "base";
      if (!treatment) continue; // bracket we don't model (Gold, Championship, …)
      const key = `${code}|${treatment}`;
      if (!index.has(key)) index.set(key, row.cents);
    }
    return index;
  }

  private buildPkIndex(csv: string): Map<string, number> {
    const index = new Map<string, number>();
    const lines = csv.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const row = PriceChartingAdapter.splitRow(line);
      if (!row) continue;
      if (BRACKET.test(row.product)) continue; // skip reverse-holo / variant re-listings
      const num = row.product.match(PK_NUMBER)?.[1];
      if (!num) continue;
      const key = `${row.console}|${num}`;
      if (!index.has(key)) index.set(key, row.cents);
    }
    return index;
  }

  /**
   * Sealed products (Booster Box, ETB, …). Same CSV as the cards; we keep the
   * rows that are NOT singles (no "#123" / "OP07-002") and not bracketed
   * variants, keyed by console-name + exact product-name.
   */
  private buildSealedIndex(csv: string): Map<string, number> {
    const index = new Map<string, number>();
    const lines = csv.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const row = PriceChartingAdapter.splitRow(line);
      if (!row) continue;
      if (PK_NUMBER.test(row.product) || OP_CODE.test(row.product) || BRACKET.test(row.product)) {
        continue;
      }
      const key = `${row.console}|${row.product.trim()}`;
      if (!index.has(key)) index.set(key, row.cents);
    }
    return index;
  }

  private getOpData(): Promise<CategoryData> {
    return (this.opData ??= this.downloadCsv("one-piece-cards").then((c) => ({
      cards: this.buildOpIndex(c),
      sealed: this.buildSealedIndex(c),
    })));
  }

  private getPkData(): Promise<CategoryData> {
    return (this.pkData ??= this.downloadCsv("pokemon-cards").then((c) => ({
      cards: this.buildPkIndex(c),
      sealed: this.buildSealedIndex(c),
    })));
  }

  async fetchCardPrices(
    set: CatalogSet,
    cards: PriceableCard[],
  ): Promise<PriceSnapshotInput[]> {
    this.assertToken();
    if (cards.length === 0) return [];

    // Game is unambiguous from the collector-number shape: One Piece codes look
    // like OP09-004 / ST01-007, Pokémon numbers never carry that dash.
    const isOnePiece = cards.some((c) => OP_CODE.test(c.number));
    const index = (isOnePiece ? await this.getOpData() : await this.getPkData()).cards;
    const consoleName = isOnePiece ? null : (PK_CONSOLE_OVERRIDE[set.code] ?? `Pokemon ${set.name}`);

    const capturedAt = new Date();
    const out: PriceSnapshotInput[] = [];
    for (const card of cards) {
      const key = isOnePiece
        ? `${card.number}|${canonTreatment(card.treatment)}`
        : `${consoleName}|${card.number}`;
      const cents = index.get(key);
      if (cents === undefined || cents <= 0) continue;

      // Resolve back to our card via any of its external ids (the job's
      // cardIdByExternal is keyed on those). Every ingested card has one.
      const externalCardId = Object.values(card.externalIds)[0];
      if (!externalCardId) continue;

      out.push({ externalCardId, sourceId: this.id, priceCents: cents, kind: "raw", capturedAt });
    }
    return out;
  }

  async fetchSealedPrices(set: CatalogSet): Promise<PriceSnapshotInput[]> {
    this.assertToken();
    // Pokémon sets carry a pokemontcg_io external id; One Piece sets (optcgapi)
    // do not — enough to pick the category and console-name scheme.
    const isOnePiece = !("pokemontcg_io" in set.externalIds);
    const data = isOnePiece ? await this.getOpData() : await this.getPkData();
    const consoleName = isOnePiece
      ? `One Piece ${set.name}`
      : (PK_CONSOLE_OVERRIDE[set.code] ?? `Pokemon ${set.name}`);

    const capturedAt = new Date();
    const out: PriceSnapshotInput[] = [];
    for (const [type, labels] of Object.entries(SEALED_LABELS)) {
      let cents: number | undefined;
      for (const label of labels) {
        cents = data.sealed.get(`${consoleName}|${label}`);
        if (cents !== undefined && cents > 0) break;
      }
      if (cents === undefined || cents <= 0) continue;
      // externalProductId is our product-type; the job resolves it to the set's
      // sealed product of that type.
      out.push({ externalProductId: type, sourceId: this.id, priceCents: cents, kind: "sealed", capturedAt });
    }
    return out;
  }
}
