import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../scripts/blog-backlog/cli.js');

let tmpDir;
let file;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-'));
  file = path.join(tmpDir, 'blog-backlog.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function run(args) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf-8' });
}

describe('cli init', () => {
  it('creates an empty backlog when file is absent', async () => {
    run(['init', '--file', file]);
    const raw = JSON.parse(await fs.readFile(file, 'utf-8'));
    expect(raw.version).toBe(1);
    expect(raw.entries).toEqual([]);
  });

  it('is a no-op when the file already exists', async () => {
    run(['init', '--file', file]);
    const before = await fs.readFile(file, 'utf-8');
    run(['init', '--file', file]);
    const after = await fs.readFile(file, 'utf-8');
    expect(after).toBe(before);
  });
});

describe('cli cursor', () => {
  it('prints the current cursor as JSON', () => {
    run(['init', '--file', file]);
    const out = run(['cursor', '--file', file]);
    expect(JSON.parse(out)).toEqual({ pr: 0, rfc: '', transcript: '1970-01-01T00:00:00Z' });
  });
});

describe('cli apply', () => {
  it('applies a plan and prints a summary', async () => {
    run(['init', '--file', file]);
    const planFile = path.join(tmpDir, 'plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify({
        new: [
          {
            title: 'Hello world',
            hook: 'a hook',
            audience: 'en-tech',
            targetLength: 1000,
            supporting: [{ type: 'pr', number: 7 }],
            rationale: 'because',
          },
        ],
        merge: [],
        skip: [],
        cursor: { pr: 7 },
      }),
    );
    const out = run(['apply', '--plan', planFile, '--file', file]);
    const summary = JSON.parse(out);
    expect(summary.added).toBe(1);
    expect(summary.cursor.pr).toBe(7);

    const reloaded = JSON.parse(await fs.readFile(file, 'utf-8'));
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0].title).toBe('Hello world');
  });
});

describe('cli get', () => {
  it('prints the entry as JSON', async () => {
    run(['init', '--file', file]);
    const planFile = path.join(tmpDir, 'plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify({
        new: [
          {
            title: 'X',
            hook: 'h',
            audience: 'en-tech',
            targetLength: 1000,
            supporting: [{ type: 'pr', number: 1 }],
            rationale: '',
          },
        ],
        merge: [],
        skip: [],
        cursor: {},
      }),
    );
    run(['apply', '--plan', planFile, '--file', file]);
    const reloaded = JSON.parse(await fs.readFile(file, 'utf-8'));
    const id = reloaded.entries[0].id;

    const out = run(['get', id, '--file', file]);
    expect(JSON.parse(out).id).toBe(id);
  });

  it('exits non-zero when the id is missing', () => {
    run(['init', '--file', file]);
    expect(() => run(['get', 'nope-zzzz', '--file', file])).toThrow();
  });
});

describe('cli update', () => {
  it('patches status and notes', async () => {
    run(['init', '--file', file]);
    const planFile = path.join(tmpDir, 'plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify({
        new: [
          {
            title: 'X',
            hook: 'h',
            audience: 'en-tech',
            targetLength: 1000,
            supporting: [{ type: 'pr', number: 1 }],
            rationale: '',
          },
        ],
        merge: [],
        skip: [],
        cursor: {},
      }),
    );
    run(['apply', '--plan', planFile, '--file', file]);
    const reloaded = JSON.parse(await fs.readFile(file, 'utf-8'));
    const id = reloaded.entries[0].id;

    const out = run([
      'update',
      id,
      '--status',
      'greenlit',
      '--notes',
      'do this one',
      '--file',
      file,
    ]);
    const updated = JSON.parse(out);
    expect(updated.status).toBe('greenlit');
    expect(updated.notes).toBe('do this one');
  });
});
