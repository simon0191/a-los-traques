import accessoryCatalog from '../data/accessories.json';

/**
 * List the accessory categories that have at least one calibrated animation
 * for a given fighter. Gates which category tabs are enabled in
 * `AccessorySelectScene` and whether P2 is shown at all.
 *
 * Extracted from `AccessorySelectScene.js` so it can be unit-tested without
 * pulling in Phaser.
 */
export function calibratedCategories(manifest, fighterId) {
  const cats = manifest?.calibrations?.[fighterId];
  if (!cats) return [];
  // Require an idle[0] frame — the picker anchors its preview there and
  // downstream tabs would otherwise render blank for null/empty entries.
  return Object.keys(cats).filter(
    (cat) =>
      accessoryCatalog.some((a) => a.category === cat) && cats[cat]?.idle?.frames?.[0] != null,
  );
}

/**
 * Pick one random accessory per calibrated category for a fighter. Used to
 * give bots (tournament AI, 1P vs AI) a loadout so they're not at a visual
 * or (future) stat-bonus disadvantage.
 *
 * Returns `{ [category]: accessoryId }` — empty object if the fighter has
 * no calibrations or the catalog has no options for any calibrated category.
 *
 * `rng` defaults to `Math.random` but accepts a seeded PRNG (mulberry32 etc.)
 * for deterministic E2E replays and tournament reproducibility.
 */
export function autoPickAccessories(manifest, fighterId, rng = Math.random) {
  const out = {};
  for (const category of calibratedCategories(manifest, fighterId)) {
    const options = accessoryCatalog.filter((a) => a.category === category);
    if (options.length === 0) continue;
    const idx = Math.floor(rng() * options.length) % options.length;
    out[category] = options[idx].id;
  }
  return out;
}
