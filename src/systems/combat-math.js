/**
 * Pure damage calculation using integer math for determinism.
 * @param {number} baseDamage - Raw move damage
 * @param {number} attackerPower - Attacker's power stat (1-5)
 * @param {number} defenderDefense - Defender's defense stat (1-5)
 * @returns {number} Final damage (rounded integer)
 */
export function calculateDamage(baseDamage, attackerPower, defenderDefense) {
  // Integer-scaled modifiers (1000x):
  // powerMod: 700 + power*100 → range 800..1200 (was 0.8..1.2)
  // defMod:  1100 - def*40   → range 900..1060 (was 0.90..1.06)
  const powerMod = 700 + attackerPower * 100;
  const defMod = 1100 - defenderDefense * 40;
  return Math.round((baseDamage * powerMod * defMod) / 1_000_000);
}
