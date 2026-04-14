import { describe, expect, it, vi } from 'vitest';
import { OverlaySession } from '../../src/editor/OverlaySession.js';
import { exportOverlayStrip } from '../../src/editor/OverlayExporter.js';

/**
 * Fake canvas / context that records the sequence of drawing operations.
 * We can then assert the exporter emitted the correct save/translate/rotate/scale/
 * drawImage/restore sequence per frame without needing a real browser canvas.
 */
function fakeCanvasFactory() {
  const instances = [];
  return {
    create(width, height) {
      const ops = [];
      const ctx = {
        save: () => ops.push({ op: 'save' }),
        restore: () => ops.push({ op: 'restore' }),
        translate: (x, y) => ops.push({ op: 'translate', x, y }),
        rotate: (r) => ops.push({ op: 'rotate', r }),
        scale: (sx, sy) => ops.push({ op: 'scale', sx, sy }),
        drawImage: (img, dx, dy) => ops.push({ op: 'drawImage', imgW: img.width, dx, dy }),
      };
      const canvas = { width, height, ops, getContext: () => ctx };
      instances.push(canvas);
      return canvas;
    },
    instances,
  };
}

function makeSession() {
  return new OverlaySession({
    fighterId: 'cata',
    accessoryId: 'sombrero_catalina',
    animation: 'walk',
    frameCount: 3,
  });
}

describe('OverlayExporter', () => {
  it('creates a canvas sized frameWidth * frameCount × frameHeight', () => {
    const factory = fakeCanvasFactory();
    exportOverlayStrip({
      session: makeSession(),
      accessoryImage: { width: 128, height: 128 },
      frameWidth: 128,
      frameHeight: 64,
      createCanvas: factory.create,
    });
    expect(factory.instances[0].width).toBe(128 * 3);
    expect(factory.instances[0].height).toBe(64);
  });

  it('emits save/translate/rotate/scale/drawImage/restore per frame in order', () => {
    const factory = fakeCanvasFactory();
    exportOverlayStrip({
      session: makeSession(),
      accessoryImage: { width: 64, height: 64 },
      frameWidth: 128,
      frameHeight: 128,
      createCanvas: factory.create,
    });
    const ops = factory.instances[0].ops;
    expect(ops).toHaveLength(3 * 6);
    for (let i = 0; i < 3; i++) {
      const base = i * 6;
      expect(ops[base]).toEqual({ op: 'save' });
      expect(ops[base + 1].op).toBe('translate');
      expect(ops[base + 2].op).toBe('rotate');
      expect(ops[base + 3].op).toBe('scale');
      expect(ops[base + 4].op).toBe('drawImage');
      expect(ops[base + 5]).toEqual({ op: 'restore' });
    }
  });

  it('translates each frame to i * frameWidth + transform.x', () => {
    const s = makeSession();
    s.setTransform(0, { x: 10, y: 20, rotation: 0, scale: 0.5 });
    s.setTransform(1, { x: 15, y: 30, rotation: 0, scale: 0.5 });
    s.setTransform(2, { x: 20, y: 40, rotation: 0, scale: 0.5 });

    const factory = fakeCanvasFactory();
    exportOverlayStrip({
      session: s,
      accessoryImage: { width: 128, height: 128 },
      frameWidth: 128,
      frameHeight: 128,
      createCanvas: factory.create,
    });
    const translates = factory.instances[0].ops.filter((o) => o.op === 'translate');
    expect(translates[0]).toEqual({ op: 'translate', x: 10, y: 20 });
    expect(translates[1]).toEqual({ op: 'translate', x: 128 + 15, y: 30 });
    expect(translates[2]).toEqual({ op: 'translate', x: 256 + 20, y: 40 });
  });

  it('draws the image centered around the translated origin', () => {
    const factory = fakeCanvasFactory();
    exportOverlayStrip({
      session: makeSession(),
      accessoryImage: { width: 80, height: 80 },
      frameWidth: 128,
      frameHeight: 128,
      createCanvas: factory.create,
    });
    const drawImages = factory.instances[0].ops.filter((o) => o.op === 'drawImage');
    for (const d of drawImages) {
      expect(d.dx).toBe(-40);
      expect(d.dy).toBe(-40);
      expect(d.imgW).toBe(80);
    }
  });

  it('applies each frame rotation and scale as-is', () => {
    const s = makeSession();
    s.setTransform(0, { x: 0, y: 0, rotation: 1.2, scale: 0.3 });
    s.setTransform(1, { x: 0, y: 0, rotation: -0.5, scale: 0.8 });
    s.setTransform(2, { x: 0, y: 0, rotation: 0, scale: 1 });

    const factory = fakeCanvasFactory();
    exportOverlayStrip({
      session: s,
      accessoryImage: { width: 128, height: 128 },
      frameWidth: 128,
      frameHeight: 128,
      createCanvas: factory.create,
    });
    const rotates = factory.instances[0].ops.filter((o) => o.op === 'rotate');
    const scales = factory.instances[0].ops.filter((o) => o.op === 'scale');
    expect(rotates.map((r) => r.r)).toEqual([1.2, -0.5, 0]);
    expect(scales.map((s) => s.sx)).toEqual([0.3, 0.8, 1]);
    expect(scales.map((s) => s.sy)).toEqual([0.3, 0.8, 1]);
  });

  it('throws when inputs are missing', () => {
    const create = vi.fn();
    expect(() =>
      exportOverlayStrip({ accessoryImage: {}, frameWidth: 1, frameHeight: 1, createCanvas: create }),
    ).toThrow(/session/);
    expect(() =>
      exportOverlayStrip({ session: makeSession(), frameWidth: 1, frameHeight: 1, createCanvas: create }),
    ).toThrow(/accessoryImage/);
    expect(() =>
      exportOverlayStrip({
        session: makeSession(),
        accessoryImage: {},
        frameWidth: 0,
        frameHeight: 1,
        createCanvas: create,
      }),
    ).toThrow(/frame dimensions/);
    expect(() =>
      exportOverlayStrip({
        session: makeSession(),
        accessoryImage: {},
        frameWidth: 1,
        frameHeight: 1,
      }),
    ).toThrow(/createCanvas/);
  });

  it('throws when getContext returns falsy', () => {
    const badFactory = () => ({ getContext: () => null });
    expect(() =>
      exportOverlayStrip({
        session: makeSession(),
        accessoryImage: { width: 10, height: 10 },
        frameWidth: 1,
        frameHeight: 1,
        createCanvas: badFactory,
      }),
    ).toThrow(/2d context/);
  });
});
