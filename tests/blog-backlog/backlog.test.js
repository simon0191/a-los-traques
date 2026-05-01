import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadBacklog, saveBacklog, emptyBacklog } from '../../scripts/blog-backlog/backlog.js';

let tmpDir;
let file;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlog-'));
  file = path.join(tmpDir, 'blog-backlog.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('emptyBacklog', () => {
  it('produces a v1 backlog with epoch cursor and no entries', () => {
    const b = emptyBacklog();
    expect(b).toEqual({
      version: 1,
      cursor: { pr: 0, rfc: '', transcript: '1970-01-01T00:00:00Z' },
      entries: [],
    });
  });
});

describe('loadBacklog', () => {
  it('returns emptyBacklog when file is absent', async () => {
    const b = await loadBacklog(file);
    expect(b).toEqual(emptyBacklog());
  });

  it('round-trips through saveBacklog', async () => {
    const original = emptyBacklog();
    original.cursor.pr = 42;
    original.entries.push({
      id: 'sample-abcd',
      title: 'Sample',
      hook: 'A test entry',
      audience: 'en-tech',
      targetLength: 1500,
      supporting: [{ type: 'pr', number: 42 }],
      status: 'proposed',
      notes: '',
      rationale: 'because',
      createdAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-05-01T00:00:00Z',
      draftPath: null,
    });
    await saveBacklog(file, original);
    const reloaded = await loadBacklog(file);
    expect(reloaded).toEqual(original);
  });

  it('rejects backlog with unknown version', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 999, cursor: {}, entries: [] }));
    await expect(loadBacklog(file)).rejects.toThrow(/version/i);
  });

  it('rejects entry with invalid status', async () => {
    const bad = emptyBacklog();
    bad.entries.push({
      id: 'x',
      title: 't',
      hook: 'h',
      audience: 'en-tech',
      targetLength: 100,
      supporting: [],
      status: 'banana',
      notes: '',
      rationale: '',
      createdAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-05-01T00:00:00Z',
      draftPath: null,
    });
    await fs.writeFile(file, JSON.stringify(bad));
    await expect(loadBacklog(file)).rejects.toThrow(/status/i);
  });
});
