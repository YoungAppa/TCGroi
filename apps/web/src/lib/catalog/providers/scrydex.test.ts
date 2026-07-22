import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/lib/env";

import type { CatalogSet } from "../types";
import { ScrydexCatalogAdapter } from "./scrydex";

function respond(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function envelope(data: unknown[]) {
  return { data, page: 1, page_size: 100, total_count: data.length };
}
function opSet(): CatalogSet {
  return { code: "OP-01", name: "Romance Dawn", releaseDate: null, language: "EN", expectedCardCount: null, externalIds: { scrydex: "OP01" } };
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://t:t@localhost:5432/t";
  process.env.ADMIN_SECRET = "test-secret";
  process.env.TCGPLAYER_MIRROR_API_KEY = "k";
  process.env.SCRYDEX_TEAM_ID = "team";
  resetEnvCache();
});
afterEach(() => {
  delete process.env.TCGPLAYER_MIRROR_API_KEY;
  delete process.env.SCRYDEX_TEAM_ID;
  resetEnvCache();
  vi.unstubAllGlobals();
});

describe("ScrydexCatalogAdapter.fetchCards", () => {
  it("emits one row per pack tier and skips promo/special variants", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "OP01-120",
              name: "Shanks",
              number: "120",
              rarity_code: "SEC",
              variants: [
                { name: "foil", images: [{ type: "front", large: "img/base" }] }, // SEC base
                { name: "altArt", images: [{ type: "front", large: "img/alt" }] },
                { name: "mangaAltArt", images: [{ type: "front", large: "img/manga" }] },
                { name: "premiumAltArt", images: [] }, // special release — skip
                { name: "championshipStamp", images: [] }, // promo — skip
              ],
            },
          ]),
        ),
      ),
    );

    const cards = await new ScrydexCatalogAdapter().fetchCards(opSet());
    const byTreatment = new Map(cards.map((c) => [c.treatment, c]));

    expect([...byTreatment.keys()].sort()).toEqual(["alt_art", "base", "manga"]);
    // The $4,000 manga is now its OWN manga_rare card — the whole point.
    expect(byTreatment.get("manga")!.rarity).toBe("manga_rare");
    expect(byTreatment.get("base")!.rarity).toBe("secret_rare"); // SEC base from foil
    expect(byTreatment.get("alt_art")!.rarity).toBe("alt_art");
    expect(byTreatment.get("manga")!.number).toBe("OP01-120");
    expect(byTreatment.get("manga")!.externalIds).toEqual({ scrydex: "OP01-120:manga" });
    expect(byTreatment.get("manga")!.imageUrl).toBe("img/manga");
  });

  it("uses 'normal' for the base of a rare and maps rarity_code to base rarity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "OP01-025",
              name: "Some Rare",
              rarity_code: "R",
              variants: [
                { name: "normal", images: [] },
                { name: "foil", images: [] }, // a rare's foil parallel — not its own tier
              ],
            },
          ]),
        ),
      ),
    );

    const cards = await new ScrydexCatalogAdapter().fetchCards(opSet());
    expect(cards).toHaveLength(1);
    expect(cards[0]!.treatment).toBe("base");
    expect(cards[0]!.rarity).toBe("rare");
  });
});
