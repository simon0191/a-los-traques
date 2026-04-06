/**
 * Pure damage calculation using integer math for determinism.
 * @param {number} baseDamage - Raw move damage
 * @param {number} attackerPower - Attacker's power stat (1-5)
 * @param {number} defenderDefense - Defender's defense stat (1-5)
 * @returns {number} Final damage (rounded integer)
 */
export function calculateDamage(baseDamage, attackerPower, defenderDefense) {
  // Integer-scaled modifiers (1000x):
  // powerMod: 850 + power*50  → range 900..1100 (0.90..1.10)
  // defMod:  1200 - def*60   → range 900..1140 (0.90..1.14)
  const powerMod = 850 + attackerPower * 50;
  const defMod = 1200 - defenderDefense * 60;
  return Math.round((baseDamage * powerMod * defMod) / 1_000_000);
}

/**
 * Apply combo damage scaling. Second hit deals 80%, third 65%, fourth+ 50%.
 * Uses integer math (1000x scale) for determinism.
 * @param {number} baseDamage - Damage before scaling
 * @param {number} comboCount - Number of hits already in combo (0 = first hit)
 * @returns {number} Scaled damage (integer)
 */
export function comboScaledDamage(baseDamage, comboCount) {
  const SCALING = [1000, 800, 650, 500]; // 1000x fixed-point
  const scale = SCALING[Math.min(comboCount, SCALING.length - 1)];
  return Math.trunc((baseDamage * scale) / 1000);
}
