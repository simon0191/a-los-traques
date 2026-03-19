/**
 * Pure damage calculation: applies attacker power and defender defense modifiers.
 * @param {number} baseDamage - Raw move damage
 * @param {number} attackerPower - Attacker's power stat (1-5)
 * @param {number} defenderDefense - Defender's defense stat (1-5)
 * @returns {number} Final damage (rounded integer)
 */
export function calculateDamage(baseDamage, attackerPower, defenderDefense) {
  const powerMod = 0.7 + attackerPower * 0.1;
  const defMod = 1.1 - defenderDefense * 0.04;
  return Math.round(baseDamage * powerMod * defMod);
}
