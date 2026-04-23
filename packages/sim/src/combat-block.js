/**
 * Calculate reduced damage when blocking (20% of original, truncated).
 * Uses integer division for deterministic cross-platform results.
 * @param {number} damage
 * @returns {number}
 */
export function calculateBlockDamage(damage) {
  return Math.trunc(damage / 5);
}
