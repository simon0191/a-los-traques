import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storage, validatePathComponent } from '../../api/_lib/storage.js';

vi.unmock('../../api/_lib/storage.js');

const TEST_BASE = path.join(process.cwd(), 'tmp', 'debug-bundles');

describe('storage (local backend)', () => {
  const fightId = 'test-fight-id-1234';
  const bundleContent = JSON.stringify({ version: 2, source: 'debug', data: 'test' });

  beforeEach(() => {
    process.env.STORAGE_BACKEND = 'local';
    // Clean up test directory
    const dir = path.join(TEST_BASE, fightId);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    const dir = path.join(TEST_BASE, fightId);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('uploads a bundle to the correct path', async () => {
    await storage.uploadBundle(fightId, 0, 1, bundleContent);
    const filePath = path.join(TEST_BASE, fightId, 'p0_round1.json');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(bundleContent);
  });

  it('downloads an uploaded bundle', async () => {
    await storage.uploadBundle(fightId, 0, 1, bundleContent);
    const result = await storage.downloadBundle(fightId, 0, 1);
    expect(result).toBe(bundleContent);
  });

  it('returns null for non-existent bundle', async () => {
    const result = await storage.downloadBundle(fightId, 0, 99);
    expect(result).toBeNull();
  });

  it('deletes all bundles for a fightId', async () => {
    await storage.uploadBundle(fightId, 0, 1, bundleContent);
    await storage.uploadBundle(fightId, 1, 1, bundleContent);
    await storage.uploadBundle(fightId, 0, 0, bundleContent);

    await storage.deleteBundles(fightId);

    const dir = path.join(TEST_BASE, fightId);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('lists bundles for a fightId', async () => {
    await storage.uploadBundle(fightId, 0, 1, bundleContent);
    await storage.uploadBundle(fightId, 1, 1, bundleContent);
    await storage.uploadBundle(fightId, 0, 0, bundleContent);

    const bundles = await storage.listBundles(fightId);
    expect(bundles).toHaveLength(3);
    expect(bundles).toContainEqual({ slot: 0, round: 0, key: `${fightId}/p0_round0.json` });
    expect(bundles).toContainEqual({ slot: 0, round: 1, key: `${fightId}/p0_round1.json` });
    expect(bundles).toContainEqual({ slot: 1, round: 1, key: `${fightId}/p1_round1.json` });
  });

  it('returns empty list for non-existent fightId', async () => {
    const bundles = await storage.listBundles('nonexistent');
    expect(bundles).toEqual([]);
  });

  it('handles delete on non-existent directory', async () => {
    // Should not throw
    await storage.deleteBundles('nonexistent');
  });

  it('overwrites existing bundle on re-upload', async () => {
    await storage.uploadBundle(fightId, 0, 1, bundleContent);
    const newContent = JSON.stringify({ version: 2, updated: true });
    await storage.uploadBundle(fightId, 0, 1, newContent);
    const result = await storage.downloadBundle(fightId, 0, 1);
    expect(result).toBe(newContent);
  });
});

describe('validatePathComponent', () => {
  it('accepts valid path components', () => {
    expect(() => validatePathComponent('abc-123', 'test')).not.toThrow();
    expect(() => validatePathComponent('0', 'test')).not.toThrow();
    expect(() => validatePathComponent('fight-uuid-here', 'test')).not.toThrow();
  });

  it('rejects path traversal with ..', () => {
    expect(() => validatePathComponent('..', 'test')).toThrow('Invalid test');
    expect(() => validatePathComponent('../etc/passwd', 'test')).toThrow('Invalid test');
  });

  it('rejects forward slashes', () => {
    expect(() => validatePathComponent('a/b', 'test')).toThrow('Invalid test');
  });

  it('rejects backslashes', () => {
    expect(() => validatePathComponent('a\\b', 'test')).toThrow('Invalid test');
  });
});
