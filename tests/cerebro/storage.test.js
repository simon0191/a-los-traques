import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OBS_DIM } from '../../scripts/cerebro/env.js';
import { createStorage, writeNpy } from '../../scripts/cerebro/storage.js';

describe('storage', () => {
  const tmpDirs = [];
  function makeTmpDir() {
    const d = mkdtempSync(join(tmpdir(), 'cerebro-test-'));
    tmpDirs.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it('writeNpy produces valid .npy header', () => {
    const dir = makeTmpDir();
    const path = join(dir, 'test.npy');
    const data = new Float32Array([1.0, 2.0, 3.0]);
    writeNpy(path, data, [3]);

    const buf = readFileSync(path);
    // Magic: \x93NUMPY
    expect(buf[0]).toBe(0x93);
    expect(buf.toString('ascii', 1, 6)).toBe('NUMPY');
    // Version 1.0
    expect(buf[6]).toBe(1);
    expect(buf[7]).toBe(0);
    // Header should contain dtype and shape
    const headerLen = buf.readUInt16LE(8);
    const header = buf.toString('ascii', 10, 10 + headerLen);
    expect(header).toContain("'descr': '<f4'");
    expect(header).toContain("'shape': (3,)");
  });

  it('writeNpy 2D shape writes correct header', () => {
    const dir = makeTmpDir();
    const path = join(dir, 'test2d.npy');
    const data = new Float32Array(6); // 2 rows × 3 cols
    writeNpy(path, data, [2, 3]);

    const buf = readFileSync(path);
    const headerLen = buf.readUInt16LE(8);
    const header = buf.toString('ascii', 10, 10 + headerLen);
    expect(header).toContain("'shape': (2, 3)");
  });

  it('createStorage flushes batch to disk', () => {
    const dir = makeTmpDir();
    const storage = createStorage({ outDir: dir, batchSize: 5 });

    const obs = new Float32Array(OBS_DIM);
    const nextObs = new Float32Array(OBS_DIM);
    obs[0] = 0.5;
    nextObs[0] = 0.6;

    // Add 5 transitions — should trigger auto-flush
    for (let i = 0; i < 5; i++) {
      storage.add(obs, i, 0.1 * i, nextObs, i === 4);
    }

    expect(storage.totalTransitions()).toBe(5);

    // Check batch directory was created
    const batchDir = join(dir, 'batch_00000');
    const obsFile = readFileSync(join(batchDir, 'obs.npy'));
    expect(obsFile.length).toBeGreaterThan(0);

    const actionsFile = readFileSync(join(batchDir, 'actions.npy'));
    expect(actionsFile.length).toBeGreaterThan(0);
  });

  it('flush writes partial batch', () => {
    const dir = makeTmpDir();
    const storage = createStorage({ outDir: dir, batchSize: 100 });

    const obs = new Float32Array(OBS_DIM);
    const nextObs = new Float32Array(OBS_DIM);

    // Add 3 transitions (partial batch)
    for (let i = 0; i < 3; i++) {
      storage.add(obs, i, 0.1, nextObs, false);
    }
    storage.flush();

    expect(storage.totalTransitions()).toBe(3);
    const batchDir = join(dir, 'batch_00000');
    const rewardsFile = readFileSync(join(batchDir, 'rewards.npy'));
    expect(rewardsFile.length).toBeGreaterThan(0);
  });
});
