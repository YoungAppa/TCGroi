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
  const CHASE_FLOOR_CENTS = 600; // above bulk / cheap parallels
  const CHASE_CEIL_CENTS = 15000; // the EV tier's ceiling; above it = display-only secret
  const gemSetIds = sql`(
    select s.id from sets s join games g on s.game_id = g.id
    join pull_rate_tables prt on prt.set_id = s.id and prt.is_active = true
    where g.slug = 'pokemon' and s.language = 'ZH' and s.code like 'gem-pack%')`;
  const priced = (lo: number | null, hi: number | null) => sql`
    exists (
      select 1 from latest_prices lp
      where lp.card_id = cards.id and lp.kind = 'raw'
        ${lo === null ? sql`` : sql`and lp.price_cents >= ${lo}`}
        ${hi === null ? sql`` : sql`and lp.price_cents <= ${hi}`})`;

  // Reset first so re-runs re-derive from scratch (and clear stale tags/flags).
  await db.execute(sql`
    update cards set rarity = 'unknown', display_only = false
    where rarity = 'cn_chase' and set_id in ${gemSetIds}
  `);
  // EV chase tier: special-art band, in EV.
  await db.execute(sql`
    update cards set rarity = 'cn_chase', display_only = false
    where set_id in ${gemSetIds}
      and cards.name not ilike '%energy%'
      and ${priced(CHASE_FLOOR_CENTS, CHASE_CEIL_CENTS)}
  `);
  // Display-only ultra-secret: shown in the gallery, never in EV.
  await db.execute(sql`
    update cards set rarity = 'cn_chase', display_only = true
    where set_id in ${gemSetIds}
      and cards.name not ilike '%energy%'
      and ${priced(CHASE_CEIL_CENTS + 1, null)}
  `);
}
