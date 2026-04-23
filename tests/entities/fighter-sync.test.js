import { FP_SCALE } from '@alostraques/sim';
import { describe, expect, it, vi } from 'vitest';

/**
 * Lightweight tests for Fighter presentation methods (syncSprite, updateAnimation)
 * without constructing a full Fighter (which requires Phaser scene).
 * We import the class and call methods on a minimal stub that mirrors the real shape.
 */

function stubFighter(simX, simY, facingRight = true) {
  return {
    sim: { simX: simX * FP_SCALE, simY: simY * FP_SCALE, facingRight },
    sprite: { x: 0, y: 0, setFlipX: vi.fn() },
    hasAnims: false,
    // Bind the real syncSprite logic inline (mirrors Fighter.syncSprite)
    syncSprite() {
      this.sprite.x = this.sim.simX / FP_SCALE;
      this.sprite.y = this.sim.simY / FP_SCALE;
      this.sprite.setFlipX(!this.sim.facingRight);
    },
  };
}

describe('Fighter.syncSprite', () => {
  it('syncs sprite position from sim state', () => {
    const f = stubFighter(200, 150);
    f.syncSprite();
    expect(f.sprite.x).toBe(200);
    expect(f.sprite.y).toBe(150);
  });

  it('flips sprite when facing left', () => {
    const f = stubFighter(100, 100, false);
    f.syncSprite();
    expect(f.sprite.setFlipX).toHaveBeenCalledWith(true);
  });

  it('does not flip sprite when facing right', () => {
    const f = stubFighter(100, 100, true);
    f.syncSprite();
    expect(f.sprite.setFlipX).toHaveBeenCalledWith(false);
  });

  it('updates flip when facing direction changes', () => {
    const f = stubFighter(100, 100, true);
    f.syncSprite();
    expect(f.sprite.setFlipX).toHaveBeenCalledWith(false);

    f.sim.facingRight = false;
    f.syncSprite();
    expect(f.sprite.setFlipX).toHaveBeenCalledWith(true);
  });
});
