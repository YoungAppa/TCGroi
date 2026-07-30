import { sql } from "drizzle-orm";

import type { getDb } from "@/lib/db";

/**
 * Tag the Simplified Chinese Gem Pack chase cards. China discloses ONLY the ★★★
 * three-star per-pack odd (the gem-pack pull-rate tables anchor to it), never
 * per-card rarities, so the ★★★ pool is INFERRED from market value.
 *
 * Two tiers, split by the ceiling:
 *  - EV chase tier (`cn_chase`, $6–$150): the special-art SRs that sit above the
 *    cheap ●/◆ parallels. These drive the pack/box EV at the flat ★★★ rate.
 *  - Display-only ultra-secret (> $150): the one SAR each set carries (Captain
 *    Pikachu $274, Umbreon $242, Cubone, Ponyta …). Pulled far below the flat
 *    rate, so a uniform tier would overvalue it — kept OUT of EV via
 *    `display_only`, but still SHOWN in the card gallery (it's the headline
 *    chase; hiding it entirely is what made the pages look like they were
 *    "missing the Umbreon / the Pikachus"). Same stance as Magic's showcases.
 *
 * Basic/special Energy cards aren't art chases — excluded from both. Only RANKED
 * gem packs (active pull table = GP1–3) are tagged; the de-ranked GP4/5 stay
 * catalog-only. Reset-then-tag, so re-runs re-derive cleanly. Idempotent.
 */
export async function tagGemPackChase(db: ReturnType<typeof getDb>): Promise<void> {
  // The ★★★ pool is the true three-star tier the disclosed odd applies to — the
  // official grade from tcg.mik.moe (stored in externalIds.mik_rarity by
  // enrich-chinese-gempacks). This replaces the old price-band guess, which
  // over-valued the tier by dropping the cheap ★★★ cards it couldn't see.
  const SECRET_CEIL_CENTS = 15000; // a ★★★ dearer than this is the ultra-secret SAR
  const gemSetIds = sql`(
    select s.id from sets s join games g on s.game_id = g.id
    join pull_rate_tables prt on prt.set_id = s.id and prt.is_active = true
    where g.slug = 'pokemon' and s.language = 'ZH' and s.code like 'gem-pack%')`;
  const threeStar = sql`cards.external_ids->>'mik_rarity' = ${"★★★"}`;
  const dearerThanSecret = sql`
    exists (
      select 1 from latest_prices lp
      where lp.card_id = cards.id and lp.kind = 'raw' and lp.price_cents > ${SECRET_CEIL_CENTS})`;

  // Reset first so re-runs re-derive from scratch (and clear stale tags/flags).
  await db.execute(sql`
    update cards set rarity = 'unknown', display_only = false
    where rarity = 'cn_chase' and set_id in ${gemSetIds}
  `);
  // EV chase tier: every ★★★ card EXCEPT the ultra-secret. Uniform-within-tier
  // over the real pool — cheap ★★★ included, which is what the odd covers.
  await db.execute(sql`
    update cards set rarity = 'cn_chase', display_only = false
    where set_id in ${gemSetIds} and ${threeStar} and not ${dearerThanSecret}
  `);
  // Display-only ultra-secret: a ★★★ pulled far below the flat rate — shown in
  // the gallery but kept out of EV so a uniform tier can't over-value it.
  await db.execute(sql`
    update cards set rarity = 'cn_chase', display_only = true
    where set_id in ${gemSetIds} and ${threeStar} and ${dearerThanSecret}
  `);
  // Also surface the valuable lower-star special-art holos (★★ / ★ worth ≥ $5)
  // as display-only. They aren't part of the disclosed ★★★ odd, so they stay OUT
  // of EV — but they're real hits a buyer cares about, so showing them in the
  // gallery answers "where are the rest of the good cards?" without distorting
  // the model. (These carry rarity 'unknown' otherwise, i.e. show up nowhere.)
  const DISPLAY_FLOOR_CENTS = 500; // $5, matching the chase-gallery floor
  await db.execute(sql`
    update cards set rarity = 'cn_chase', display_only = true
    where set_id in ${gemSetIds}
      and cards.external_ids->>'mik_rarity' in ('★★', '★')
      and exists (
        select 1 from latest_prices lp
        where lp.card_id = cards.id and lp.kind = 'raw' and lp.price_cents >= ${DISPLAY_FLOOR_CENTS})
  `);
}
