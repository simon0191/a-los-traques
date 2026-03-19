import { describe, expect, it } from 'vitest';
import { FP_SCALE, GROUND_Y_FP } from '../../src/systems/FixedPoint.js';

/** Create a minimal sim fighter for block commitment tests. */
function createFighter() {
  return {
    simX: 100 * FP_SCALE,
    simY: GROUND_Y_FP,
    simVX: 0,
    state: 'idle',
    isOnGround: true,
    blockTimer: 0,
    sprite: { setTint() {}, clearTint() {} },
  };
}

function block(fighter) {
  if (fighter.state === 'attacking' || fighter.state === 'hurt' || fighter.state === 'knockdown')
    return;
  if (fighter.state !== 'blocking') {
    fighter.blockTimer = 3;
  }
  fighter.state = 'blocking';
  fighter.simVX = 0;
}

function stop(fighter) {
  if (fighter.state === 'attacking' || fighter.state === 'hurt' || fighter.state === 'knockdown')
    return;
  if (fighter.state === 'blocking' && fighter.blockTimer > 0) return;
  fighter.simVX = 0;
  if (fighter.isOnGround) fighter.state = 'idle';
}

function moveLeft(fighter, speed) {
  if (fighter.state === 'attacking' || fighter.state === 'hurt' || fighter.state === 'knockdown')
    return;
  if (fighter.state === 'blocking' && fighter.blockTimer > 0) return;
  fighter.simVX = -speed;
  fighter.state = 'walking';
}

function moveRight(fighter, speed) {
  if (fighter.state === 'attacking' || fighter.state === 'hurt' || fighter.state === 'knockdown')
    return;
  if (fighter.state === 'blocking' && fighter.blockTimer > 0) return;
  fighter.simVX = speed;
  fighter.state = 'walking';
}

function tick(fighter) {
  if (fighter.blockTimer > 0) fighter.blockTimer--;
}

const SPEED = 140 * FP_SCALE;

describe('block commitment', () => {
  it('entering block sets blockTimer to 3', () => {
    const f = createFighter();
    block(f);
    expect(f.state).toBe('blocking');
    expect(f.blockTimer).toBe(3);
  });

  it('cannot leave block via stop during commitment', () => {
    const f = createFighter();
    block(f);

    stop(f);
    expect(f.state).toBe('blocking');

    tick(f); // blockTimer = 2
    stop(f);
    expect(f.state).toBe('blocking');

    tick(f); // blockTimer = 1
    stop(f);
    expect(f.state).toBe('blocking');
  });

  it('cannot leave block via moveLeft during commitment', () => {
    const f = createFighter();
    block(f);

    moveLeft(f, SPEED);
    expect(f.state).toBe('blocking');
    expect(f.simVX).toBe(0);
  });

  it('cannot leave block via moveRight during commitment', () => {
    const f = createFighter();
    block(f);

    moveRight(f, SPEED);
    expect(f.state).toBe('blocking');
    expect(f.simVX).toBe(0);
  });

  it('can leave block after 3 ticks', () => {
    const f = createFighter();
    block(f);

    tick(f); // 2
    tick(f); // 1
    tick(f); // 0

    expect(f.blockTimer).toBe(0);

    stop(f);
    expect(f.state).toBe('idle');
  });

  it('can move after commitment expires', () => {
    const f = createFighter();
    block(f);

    tick(f);
    tick(f);
    tick(f);

    moveRight(f, SPEED);
    expect(f.state).toBe('walking');
    expect(f.simVX).toBe(SPEED);
  });

  it('holding block does not reset blockTimer', () => {
    const f = createFighter();
    block(f);
    expect(f.blockTimer).toBe(3);

    tick(f); // 2
    block(f); // already blocking, should NOT reset to 3
    expect(f.blockTimer).toBe(2);

    tick(f); // 1
    block(f);
    expect(f.blockTimer).toBe(1);
  });

  it('re-entering block after leaving resets blockTimer', () => {
    const f = createFighter();
    block(f);

    tick(f);
    tick(f);
    tick(f); // commitment expired

    stop(f);
    expect(f.state).toBe('idle');

    block(f); // new block
    expect(f.blockTimer).toBe(3);
  });

  it('blockTimer decrements exactly once per tick', () => {
    const f = createFighter();
    block(f);

    for (let i = 3; i > 0; i--) {
      expect(f.blockTimer).toBe(i);
      tick(f);
    }
    expect(f.blockTimer).toBe(0);
  });
});
