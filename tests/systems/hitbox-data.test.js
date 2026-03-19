import { describe, expect, it } from 'vitest';
import fighters from '../../src/data/fighters.json';
import { FP_SCALE, GROUND_Y_FP } from '../../src/systems/FixedPoint.js';

/** Create a minimal fighter for hitbox tests. */
function createFighter(fighterData) {
  return {
    simX: 100 * FP_SCALE,
    simY: GROUND_Y_FP,
    facingRight: true,
    state: 'attacking',
    attackFrameElapsed: 0,
    currentAttack: null,
    data: fighterData,
  };
}

/** Replicate Fighter.getAttackHitbox with per-move data. */
function getAttackHitbox(fighter) {
  if (fighter.state !== 'attacking' || !fighter.currentAttack) return null;
  const move = fighter.currentAttack;
  if (fighter.attackFrameElapsed < move.startup ||
      fighter.attackFrameElapsed >= move.startup + move.active) {
    return null;
  }
  const defaultReach = move.type.includes('Kick') ? 55 : 45;
  const reach = (move.reach || defaultReach) * FP_SCALE;
  const h = (move.height || 40) * FP_SCALE;
  const dir = fighter.facingRight ? 1 : -1;
  return {
    x: fighter.simX + dir * 10 * FP_SCALE,
    y: fighter.simY - 50 * FP_SCALE,
    w: reach * dir,
    h,
  };
}

/** Replicate Fighter.getHurtbox (state-independent for now). */
function getHurtbox(fighter) {
  return {
    x: fighter.simX - 18 * FP_SCALE,
    y: fighter.simY - 60 * FP_SCALE,
    w: 36 * FP_SCALE,
    h: 60 * FP_SCALE,
  };
}

describe('per-character hitbox data', () => {
  it('fighters with custom reach have different hitbox width', () => {
    const jeka = fighters.find(f => f.id === 'jeka');
    const simon = fighters.find(f => f.id === 'simon');

    // Jeka's lightPunch has reach: 40, Simon's uses default 45
    expect(jeka.moves.lightPunch.reach).toBe(40);
    expect(simon.moves.lightPunch.reach).toBeUndefined();

    const f1 = createFighter(jeka);
    f1.currentAttack = { type: 'lightPunch', ...jeka.moves.lightPunch };
    f1.attackFrameElapsed = jeka.moves.lightPunch.startup; // first active frame

    const f2 = createFighter(simon);
    f2.currentAttack = { type: 'lightPunch', ...simon.moves.lightPunch };
    f2.attackFrameElapsed = simon.moves.lightPunch.startup;

    const h1 = getAttackHitbox(f1);
    const h2 = getAttackHitbox(f2);

    expect(Math.abs(h1.w)).toBe(40 * FP_SCALE);
    expect(Math.abs(h2.w)).toBe(45 * FP_SCALE);
    expect(Math.abs(h1.w)).toBeLessThan(Math.abs(h2.w));
  });

  it('lini (zoner) has longer reach than default', () => {
    const lini = fighters.find(f => f.id === 'lini');

    expect(lini.moves.lightPunch.reach).toBe(55);
    expect(lini.moves.lightKick.reach).toBe(70);

    const f = createFighter(lini);
    f.currentAttack = { type: 'lightKick', ...lini.moves.lightKick };
    f.attackFrameElapsed = lini.moves.lightKick.startup;

    const hitbox = getAttackHitbox(f);
    expect(Math.abs(hitbox.w)).toBe(70 * FP_SCALE);
    expect(Math.abs(hitbox.w)).toBeGreaterThan(55 * FP_SCALE); // greater than default kick reach
  });

  it('richi (grappler) has taller hitbox', () => {
    const richi = fighters.find(f => f.id === 'richi');

    expect(richi.moves.lightPunch.height).toBe(55);
    expect(richi.moves.lightPunch.reach).toBe(35);

    const f = createFighter(richi);
    f.currentAttack = { type: 'lightPunch', ...richi.moves.lightPunch };
    f.attackFrameElapsed = richi.moves.lightPunch.startup;

    const hitbox = getAttackHitbox(f);
    expect(hitbox.h).toBe(55 * FP_SCALE);
    expect(Math.abs(hitbox.w)).toBe(35 * FP_SCALE);
  });

  it('bozzi (elastic) has extended reach', () => {
    const bozzi = fighters.find(f => f.id === 'bozzi');

    expect(bozzi.moves.lightPunch.reach).toBe(55);
    expect(bozzi.moves.lightKick.reach).toBe(65);
  });

  it('defaults work when no custom reach/height provided', () => {
    const simon = fighters.find(f => f.id === 'simon');

    const f = createFighter(simon);

    // Punch defaults
    f.currentAttack = { type: 'lightPunch', ...simon.moves.lightPunch };
    f.attackFrameElapsed = simon.moves.lightPunch.startup;
    let hitbox = getAttackHitbox(f);
    expect(Math.abs(hitbox.w)).toBe(45 * FP_SCALE); // default punch reach
    expect(hitbox.h).toBe(40 * FP_SCALE); // default height

    // Kick defaults
    f.currentAttack = { type: 'heavyKick', ...simon.moves.heavyKick };
    f.attackFrameElapsed = simon.moves.heavyKick.startup;
    hitbox = getAttackHitbox(f);
    expect(Math.abs(hitbox.w)).toBe(55 * FP_SCALE); // default kick reach
    expect(hitbox.h).toBe(40 * FP_SCALE);
  });

  it('all custom reach values are within sane range (20-80)', () => {
    for (const f of fighters) {
      for (const [moveType, move] of Object.entries(f.moves)) {
        if (move.reach != null) {
          expect(move.reach, `${f.id}.${moveType}.reach`).toBeGreaterThanOrEqual(20);
          expect(move.reach, `${f.id}.${moveType}.reach`).toBeLessThanOrEqual(80);
        }
        if (move.height != null) {
          expect(move.height, `${f.id}.${moveType}.height`).toBeGreaterThanOrEqual(20);
          expect(move.height, `${f.id}.${moveType}.height`).toBeLessThanOrEqual(80);
        }
      }
    }
  });

  it('hurtbox is consistent regardless of fighter data', () => {
    const f = createFighter(fighters[0]);
    const hurtbox = getHurtbox(f);
    expect(hurtbox.w).toBe(36 * FP_SCALE);
    expect(hurtbox.h).toBe(60 * FP_SCALE);
  });
});
