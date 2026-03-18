/**
 * Calculate reduced damage when blocking (20% of original, floored).
 * @param {number} damage
 * @returns {number}
 */
export function calculateBlockDamage(damage) {
  return Math.floor(damage * 0.2);
}
