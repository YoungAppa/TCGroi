/**
 * Re-derive the Gem Pack chase tags in place — the fast, NON-destructive way to
 * apply a tagging-rule change without the full build-chinese-pokemon-priced.ts
 * rebuild. Re-runs the cn_chase EV tier + the display-only ultra-secret tag
 * (Umbreon, Captain Pikachu, …) so those headline chases show in the gallery.
 *
 *   npx tsx --env-file=.env.local scripts/retag-chinese-gempacks.ts
 */
import { getDb } from "@/lib/db";
import { tagGemPackChase } from "@/lib/jobs/tag-gempack-chase";

async function main() {
  await tagGemPackChase(getDb());
  console.log("Gem Pack chase re-tagged (cn_chase tier + display-only ultra-secrets).");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("retag failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
