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
  return Object.keys(cats).filter((cat) => accessoryCatalog.some((a) => a.category === cat));
}
