import type { CatalogSet } from "@/lib/catalog/types";
import { getEnv } from "@/lib/env";

import { pokemonTcgIoPriceProvider } from "../providers/pokemontcgio-prices";
import { scrydexPriceProvider } from "../providers/scrydex-prices";
import {
  PriceSourceError,
  type PriceSourceAdapter,
  type PriceSnapshotInput,
  type PriceableCard,
} from "../types";

/**
 * TCGplayer market prices, via a swappable third-party mirror.
 *
 * We never call TCGplayer directly — their API is closed to new developers and
 * their ToS forbids scraping. The concrete mirror is chosen by
 * TCGPLAYER_MIRROR_PROVIDER; everything downstream sees one source id
 * ("tcgplayer_market") regardless, so swapping providers never touches the UI,
 * the EV engine, or stored snapshots.
 */

interface MirrorProvider {
  id: string;
  displayName: string;
  enabled(): boolean;
  supportsGame(gameSlug: string): boolean;
  fetchCardPrices(set: CatalogSet, cards: PriceableCard[]): Promise<PriceSnapshotInput[]>;
  fetchSealedPrices(set: CatalogSet): Promise<PriceSnapshotInput[]>;
}

const PROVIDERS: Record<string, MirrorProvider | undefined> = {
  pokemontcg_io: pokemonTcgIoPriceProvider,
  // User-selected paid upgrade: covers One Piece too (licensed), so choosing
  // it lights up OP raw prices. Needs TCGPLAYER_MIRROR_API_KEY +
  // SCRYDEX_TEAM_ID, and a live-shape verification run (probe-scrydex) before
  // its numbers are trusted.
  scrydex: scrydexPriceProvider,
  // justtcg / tcgapi could slot in here; not implemented — pokemontcg_io
  // covers Pokémon free and scrydex is the chosen paid path.
};

export class TcgplayerMarketAdapter implements PriceSourceAdapter {
  readonly id = "tcgplayer_market";
  readonly displayName = "TCGplayer Market";
  readonly supports = { cardsRaw: true, cardsGraded: false, sealed: false };

  /**
   * Routing is PER GAME, not global. Pokémon follows TCGPLAYER_MIRROR_PROVIDER
   * (default: the free pokemontcg_io mirror). One Piece has exactly one
   * licensed mirror — Scrydex — so it activates whenever the Scrydex
   * credentials exist, WITHOUT flipping the Pokémon provider: moving Pokémon's
   * ~8k daily card fetches onto the credit-metered Scrydex plan should be an
   * explicit choice (set TCGPLAYER_MIRROR_PROVIDER=scrydex), never a side
   * effect of enabling One Piece.
   */
  private provider(game: string): MirrorProvider | undefined {
    if (game === "one-piece") {
      return scrydexPriceProvider.enabled() ? scrydexPriceProvider : undefined;
    }
    return PROVIDERS[getEnv().TCGPLAYER_MIRROR_PROVIDER];
  }

  enabled(): boolean {
    const pokemon = PROVIDERS[getEnv().TCGPLAYER_MIRROR_PROVIDER];
    return (pokemon !== undefined && pokemon.enabled()) || scrydexPriceProvider.enabled();
  }

  /** Which provider is live, for /admin and the methodology attribution. */
  activeProviderName(): string | null {
    const parts: string[] = [];
    const pokemon = PROVIDERS[getEnv().TCGPLAYER_MIRROR_PROVIDER];
    if (pokemon?.enabled()) parts.push(`${pokemon.displayName} (Pokémon)`);
    if (scrydexPriceProvider.enabled()) parts.push("Scrydex (One Piece)");
    return parts.length > 0 ? parts.join(" + ") : null;
  }

  async fetchCardPrices(
    set: CatalogSet,
    cards: PriceableCard[],
  ): Promise<PriceSnapshotInput[]> {
    const game = gameOf(set);
    const p = this.provider(game);
    if (!p) {
      // One Piece without Scrydex creds is a known gap (PriceCharting still
      // covers OP), not a config fault. A bad Pokémon provider name IS one.
      if (game === "pokemon") {
        throw new PriceSourceError(
          `unknown mirror provider "${getEnv().TCGPLAYER_MIRROR_PROVIDER}"`,
          this.id,
        );
      }
      return [];
    }

    // A mirror asked for a game it can't price returns nothing rather than
    // throwing: an unsupported game is a known gap, not a fault, and the EV
    // engine already treats a missing price as unknown.
    if (!p.enabled() || !p.supportsGame(game)) return [];

    return p.fetchCardPrices(set, cards);
  }

  async fetchSealedPrices(set: CatalogSet): Promise<PriceSnapshotInput[]> {
    const game = gameOf(set);
    const p = this.provider(game);
    if (!p || !p.enabled() || !p.supportsGame(game)) return [];
    return p.fetchSealedPrices(set);
  }
}

/**
 * Infers the game from a set's external ids. Sets carry provider-keyed ids
 * (pokemontcg_io / optcgapi), which is enough to route without threading a
 * game slug through every call.
 */
function gameOf(set: CatalogSet): string {
  if (set.externalIds["pokemontcg_io"]) return "pokemon";
  if (set.externalIds["optcgapi"]) return "one-piece";
  return "unknown";
}
