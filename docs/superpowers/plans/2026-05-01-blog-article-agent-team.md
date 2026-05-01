# Blog Article Agent Team — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a five-agent system (`/blog-mine` orchestrator + `pr-miner` / `rfc-miner` / `transcript-miner` / `blog-drafter` subagents) that mines this repo's PRs, RFCs, and Claude Code transcripts into a deduped backlog of blog-post ideas, then expands chosen entries into draft posts.

**Architecture:** Slash commands handle orchestration and LLM judgment (semantic dedup, audience tagging, draft writing). All deterministic state manipulation (loading/saving the backlog JSON, ID generation, mechanical dedup, cursor management) lives in a pure `scripts/blog-backlog/` Node module exposed via a CLI so it can be unit-tested without agent calls.

**Tech Stack:** ESM Node.js (`"type": "module"`), Vitest for unit tests, `gh` CLI for PR data, `git` CLI for commit data, Claude Code subagents (`.claude/agents/<name>.md`), Claude Code skills (`.claude/skills/<name>/SKILL.md`).

---

## File Structure

**New:**
- `scripts/blog-backlog/backlog.js` — load/save `docs/blog-backlog.json` with schema validation.
- `scripts/blog-backlog/id.js` — deterministic id generation (kebab-case slug + 4-char hash).
- `scripts/blog-backlog/dedup.js` — mechanical dedup (PR# match, ref overlap) given a merge plan from the orchestrator.
- `scripts/blog-backlog/cli.js` — CLI surface (`init`, `cursor`, `apply`, `get`, `update`).
- `tests/blog-backlog/backlog.test.js` — load/save/initialise tests.
- `tests/blog-backlog/id.test.js` — id stability tests.
- `tests/blog-backlog/dedup.test.js` — apply-plan behavior tests.
- `tests/blog-backlog/cli.test.js` — CLI smoke tests via `execSync`.
- `docs/blog-backlog.json` — committed empty backlog (bootstrapped by `init`).
- `.claude/agents/pr-miner.md` — subagent.
- `.claude/agents/rfc-miner.md` — subagent.
- `.claude/agents/transcript-miner.md` — subagent.
- `.claude/agents/blog-drafter.md` — subagent.
- `.claude/skills/blog-mine/SKILL.md` — `/blog-mine` orchestrator.
- `.claude/skills/blog-expand/SKILL.md` — `/blog-expand <id>` orchestrator.
- `apps/web/content/blog/_drafts/.gitkeep` — drafts dir placeholder.

**Modified:**
- `CLAUDE.md` — append a "Blog Backlog" section under Documentation.

**Touched read-only by tests/agents only:** `docs/rfcs/*.md`, `apps/web/content/blog/welcome.md`, `~/.claude-personal/projects/*a-los-traques*`, `~/.claude/projects/*a-los-traques*`.

---

## Task 1: Bootstrap empty backlog file format

**Files:**
- Create: `scripts/blog-backlog/backlog.js`
- Create: `tests/blog-backlog/backlog.test.js`

The backlog module owns reading, writing, and validating `docs/blog-backlog.json`. The schema is defined in `docs/superpowers/specs/2026-05-01-blog-article-agent-team-design.md` § "Backlog Schema". Validation is structural only (shape + status enum); semantic checks live in dedup.

- [ ] **Step 1: Write the failing test**

Create `tests/blog-backlog/backlog.test.js`:

```javascript
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
      id: 'x', title: 't', hook: 'h', audience: 'en-tech', targetLength: 100,
      supporting: [], status: 'banana', notes: '', rationale: '',
      createdAt: '2026-05-01T00:00:00Z', lastSeenAt: '2026-05-01T00:00:00Z', draftPath: null,
    });
    await fs.writeFile(file, JSON.stringify(bad));
    await expect(loadBacklog(file)).rejects.toThrow(/status/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run tests/blog-backlog/backlog.test.js`
Expected: FAIL — `Cannot find module '../../scripts/blog-backlog/backlog.js'`.

- [ ] **Step 3: Write the module**

Create `scripts/blog-backlog/backlog.js`:

```javascript
import { promises as fs } from 'node:fs';

const VALID_STATUS = new Set(['proposed', 'greenlit', 'rejected', 'drafted', 'published']);
const VALID_AUDIENCE = new Set(['es-friends', 'en-tech', 'both']);
const VALID_REF_TYPE = new Set(['pr', 'rfc', 'transcript', 'commit', 'code']);

export function emptyBacklog() {
  return {
    version: 1,
    cursor: { pr: 0, rfc: '', transcript: '1970-01-01T00:00:00Z' },
    entries: [],
  };
}

function validate(b) {
  if (!b || typeof b !== 'object') throw new Error('backlog: not an object');
  if (b.version !== 1) throw new Error(`backlog: unsupported version ${b.version}`);
  if (!b.cursor || typeof b.cursor !== 'object') throw new Error('backlog: missing cursor');
  if (!Array.isArray(b.entries)) throw new Error('backlog: entries must be an array');
  for (const e of b.entries) {
    if (!VALID_STATUS.has(e.status)) {
      throw new Error(`backlog: entry ${e.id} has invalid status "${e.status}"`);
    }
    if (!VALID_AUDIENCE.has(e.audience)) {
      throw new Error(`backlog: entry ${e.id} has invalid audience "${e.audience}"`);
    }
    if (!Array.isArray(e.supporting)) {
      throw new Error(`backlog: entry ${e.id} supporting must be an array`);
    }
    for (const s of e.supporting) {
      if (!VALID_REF_TYPE.has(s.type)) {
        throw new Error(`backlog: entry ${e.id} ref has invalid type "${s.type}"`);
      }
    }
  }
}

export async function loadBacklog(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyBacklog();
    throw err;
  }
  const parsed = JSON.parse(raw);
  validate(parsed);
  return parsed;
}

export async function saveBacklog(file, backlog) {
  validate(backlog);
  const json = `${JSON.stringify(backlog, null, 2)}\n`;
  await fs.writeFile(file, json, 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run tests/blog-backlog/backlog.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-backlog/backlog.js tests/blog-backlog/backlog.test.js
git commit -m "feat(blog-backlog): backlog load/save with schema validation"
```

---

## Task 2: ID generation

**Files:**
- Create: `scripts/blog-backlog/id.js`
- Create: `tests/blog-backlog/id.test.js`

Backlog entry ids must be stable across re-runs so dedup matches. Format: `<kebab-slug-of-title>-<4-char-hash-of-supporting-refs>`.

- [ ] **Step 1: Write the failing test**

Create `tests/blog-backlog/id.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { makeId, slugify } from '../../scripts/blog-backlog/id.js';

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('strips punctuation', () => {
    expect(slugify('Rollback netcode: why we kill audio!')).toBe('rollback-netcode-why-we-kill-audio');
  });
  it('handles spanish characters', () => {
    expect(slugify('Cómo diseñamos los hitboxes')).toBe('como-disenamos-los-hitboxes');
  });
  it('collapses repeated dashes and trims', () => {
    expect(slugify('  --foo--bar--  ')).toBe('foo-bar');
  });
  it('truncates very long titles to 60 chars', () => {
    const long = 'a'.repeat(120);
    expect(slugify(long)).toHaveLength(60);
  });
});

describe('makeId', () => {
  it('combines slug and 4-char hash', () => {
    const id = makeId('Rollback netcode', [{ type: 'pr', number: 91 }]);
    expect(id).toMatch(/^rollback-netcode-[0-9a-f]{4}$/);
  });
  it('is stable for the same inputs', () => {
    const a = makeId('Title', [{ type: 'pr', number: 1 }, { type: 'rfc', ref: 'X.md' }]);
    const b = makeId('Title', [{ type: 'pr', number: 1 }, { type: 'rfc', ref: 'X.md' }]);
    expect(a).toBe(b);
  });
  it('is order-independent on supporting refs', () => {
    const a = makeId('Title', [{ type: 'pr', number: 1 }, { type: 'rfc', ref: 'X.md' }]);
    const b = makeId('Title', [{ type: 'rfc', ref: 'X.md' }, { type: 'pr', number: 1 }]);
    expect(a).toBe(b);
  });
  it('differs when supporting refs differ', () => {
    const a = makeId('Title', [{ type: 'pr', number: 1 }]);
    const b = makeId('Title', [{ type: 'pr', number: 2 }]);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run tests/blog-backlog/id.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `scripts/blog-backlog/id.js`:

```javascript
import { createHash } from 'node:crypto';

export function slugify(input) {
  const ascii = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, ''); // strip combining diacriticals
  const lower = ascii.toLowerCase();
  const dashed = lower.replace(/[^a-z0-9]+/g, '-');
  const trimmed = dashed.replace(/^-+|-+$/g, '');
  return trimmed.slice(0, 60);
}

function refKey(r) {
  if (r.type === 'pr') return `pr:${r.number}`;
  return `${r.type}:${r.ref}`;
}

export function makeId(title, supporting) {
  const slug = slugify(title);
  const refs = supporting.map(refKey).sort().join('|');
  const hash = createHash('sha1').update(refs).digest('hex').slice(0, 4);
  return `${slug}-${hash}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run tests/blog-backlog/id.test.js`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-backlog/id.js tests/blog-backlog/id.test.js
git commit -m "feat(blog-backlog): stable id generation from title + supporting refs"
```

---

## Task 3: Apply merge plan (mechanical dedup)

**Files:**
- Create: `scripts/blog-backlog/dedup.js`
- Create: `tests/blog-backlog/dedup.test.js`

The orchestrator (LLM-driven) decides which candidates are new, which merge into existing entries, which to skip. It emits a **plan**, and this module mechanically applies it. Plan shape:

```javascript
{
  new: [<candidate>, ...],
  merge: [{ intoId: 'existing-id-abcd', candidate: <candidate> }, ...],
  skip: [<candidate>, ...],            // recorded for the run summary, no-op on backlog
  cursor: { pr?: number, rfc?: string, transcript?: string },
}
```

A `<candidate>` has the same shape as a backlog entry minus `id`, `status`, `notes`, `createdAt`, `lastSeenAt`, `draftPath` (those get assigned by `apply`).

`apply()` rules:
- For each `new` candidate: assign `id` via `makeId`, set `status='proposed'`, `notes=''`, `createdAt=now`, `lastSeenAt=now`, `draftPath=null`. Append to entries.
- For each `merge` candidate: find entry by `intoId`. Append any new `supporting` refs (dedup by `refKey`). Update `lastSeenAt=now`. Do **not** touch `status`, `notes`, `rationale`, `title`, `hook`, `audience`, `targetLength`, `draftPath`.
- Bump cursor: `cursor.pr = max(current, plan.cursor.pr ?? current)`; rfc takes the lexicographically greater; transcript takes the later ISO timestamp.
- Return summary: `{ added: N, merged: M, skipped: K, cursor: <new cursor> }`.

- [ ] **Step 1: Write the failing test**

Create `tests/blog-backlog/dedup.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { applyPlan } from '../../scripts/blog-backlog/dedup.js';
import { emptyBacklog } from '../../scripts/blog-backlog/backlog.js';

const NOW = '2026-05-01T12:00:00Z';

function candidate(overrides = {}) {
  return {
    title: 'Sample',
    hook: 'A hook',
    audience: 'en-tech',
    targetLength: 1500,
    supporting: [{ type: 'pr', number: 42 }],
    rationale: 'because',
    ...overrides,
  };
}

describe('applyPlan', () => {
  it('appends new candidates with assigned id and proposed status', () => {
    const backlog = emptyBacklog();
    const summary = applyPlan(backlog, {
      new: [candidate()],
      merge: [],
      skip: [],
      cursor: { pr: 42 },
    }, NOW);
    expect(summary.added).toBe(1);
    expect(backlog.entries).toHaveLength(1);
    const e = backlog.entries[0];
    expect(e.id).toMatch(/^sample-[0-9a-f]{4}$/);
    expect(e.status).toBe('proposed');
    expect(e.notes).toBe('');
    expect(e.createdAt).toBe(NOW);
    expect(e.lastSeenAt).toBe(NOW);
    expect(e.draftPath).toBeNull();
    expect(backlog.cursor.pr).toBe(42);
  });

  it('merges supporting refs into the existing entry without touching user-set fields', () => {
    const backlog = emptyBacklog();
    backlog.entries.push({
      id: 'existing-aaaa',
      title: 'Existing',
      hook: 'Old hook',
      audience: 'en-tech',
      targetLength: 1500,
      supporting: [{ type: 'pr', number: 10 }],
      status: 'greenlit',
      notes: 'lead with the bug',
      rationale: 'old rationale',
      createdAt: '2026-04-01T00:00:00Z',
      lastSeenAt: '2026-04-01T00:00:00Z',
      draftPath: null,
    });

    applyPlan(backlog, {
      new: [],
      merge: [{
        intoId: 'existing-aaaa',
        candidate: candidate({
          title: 'Different title',
          hook: 'Different hook',
          supporting: [{ type: 'pr', number: 10 }, { type: 'rfc', ref: 'X.md' }],
        }),
      }],
      skip: [],
      cursor: {},
    }, NOW);

    const e = backlog.entries[0];
    expect(e.title).toBe('Existing');
    expect(e.hook).toBe('Old hook');
    expect(e.status).toBe('greenlit');
    expect(e.notes).toBe('lead with the bug');
    expect(e.rationale).toBe('old rationale');
    expect(e.supporting).toEqual([
      { type: 'pr', number: 10 },
      { type: 'rfc', ref: 'X.md' },
    ]);
    expect(e.lastSeenAt).toBe(NOW);
  });

  it('does not duplicate refs that already exist on the merge target', () => {
    const backlog = emptyBacklog();
    backlog.entries.push({
      id: 'x-aaaa', title: 'x', hook: 'h', audience: 'en-tech', targetLength: 100,
      supporting: [{ type: 'pr', number: 1 }],
      status: 'proposed', notes: '', rationale: '',
      createdAt: NOW, lastSeenAt: NOW, draftPath: null,
    });
    applyPlan(backlog, {
      new: [],
      merge: [{ intoId: 'x-aaaa', candidate: candidate({ supporting: [{ type: 'pr', number: 1 }] }) }],
      skip: [],
      cursor: {},
    }, NOW);
    expect(backlog.entries[0].supporting).toEqual([{ type: 'pr', number: 1 }]);
  });

  it('throws if merge.intoId does not exist', () => {
    const backlog = emptyBacklog();
    expect(() => applyPlan(backlog, {
      new: [],
      merge: [{ intoId: 'missing-zzzz', candidate: candidate() }],
      skip: [],
      cursor: {},
    }, NOW)).toThrow(/missing-zzzz/);
  });

  it('keeps the higher cursor value for each source', () => {
    const backlog = emptyBacklog();
    backlog.cursor = { pr: 100, rfc: '0050.md', transcript: '2026-04-01T00:00:00Z' };
    applyPlan(backlog, {
      new: [],
      merge: [],
      skip: [],
      cursor: { pr: 50, rfc: '0099.md', transcript: '2026-04-15T00:00:00Z' },
    }, NOW);
    expect(backlog.cursor).toEqual({
      pr: 100,
      rfc: '0099.md',
      transcript: '2026-04-15T00:00:00Z',
    });
  });

  it('counts skipped candidates in summary without mutating backlog', () => {
    const backlog = emptyBacklog();
    const summary = applyPlan(backlog, {
      new: [],
      merge: [],
      skip: [candidate(), candidate()],
      cursor: {},
    }, NOW);
    expect(summary.skipped).toBe(2);
    expect(backlog.entries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run tests/blog-backlog/dedup.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `scripts/blog-backlog/dedup.js`:

```javascript
import { makeId } from './id.js';

function refKey(r) {
  if (r.type === 'pr') return `pr:${r.number}`;
  return `${r.type}:${r.ref}`;
}

function maxString(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function maxNumber(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}

export function applyPlan(backlog, plan, now) {
  for (const c of plan.new ?? []) {
    const id = makeId(c.title, c.supporting);
    backlog.entries.push({
      id,
      title: c.title,
      hook: c.hook,
      audience: c.audience,
      targetLength: c.targetLength,
      supporting: c.supporting.slice(),
      status: 'proposed',
      notes: '',
      rationale: c.rationale ?? '',
      createdAt: now,
      lastSeenAt: now,
      draftPath: null,
    });
  }

  for (const m of plan.merge ?? []) {
    const target = backlog.entries.find((e) => e.id === m.intoId);
    if (!target) {
      throw new Error(`applyPlan: merge target ${m.intoId} not found`);
    }
    const existing = new Set(target.supporting.map(refKey));
    for (const r of m.candidate.supporting ?? []) {
      if (!existing.has(refKey(r))) {
        target.supporting.push(r);
        existing.add(refKey(r));
      }
    }
    target.lastSeenAt = now;
  }

  const c = plan.cursor ?? {};
  backlog.cursor = {
    pr: maxNumber(backlog.cursor.pr, c.pr),
    rfc: maxString(backlog.cursor.rfc, c.rfc),
    transcript: maxString(backlog.cursor.transcript, c.transcript),
  };

  return {
    added: (plan.new ?? []).length,
    merged: (plan.merge ?? []).length,
    skipped: (plan.skip ?? []).length,
    cursor: { ...backlog.cursor },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run tests/blog-backlog/dedup.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-backlog/dedup.js tests/blog-backlog/dedup.test.js
git commit -m "feat(blog-backlog): applyPlan merges candidates and bumps cursor"
```

---

## Task 4: CLI entrypoint

**Files:**
- Create: `scripts/blog-backlog/cli.js`
- Create: `tests/blog-backlog/cli.test.js`

Subcommands:
- `init [--file PATH]` — writes an empty backlog if the file is absent. No-op if present. Default file: `docs/blog-backlog.json`.
- `cursor [--file PATH]` — prints the current cursor as JSON to stdout (so miners can read it).
- `apply --plan PATH [--file PATH]` — reads the plan JSON, runs `applyPlan`, writes back, prints summary JSON to stdout.
- `get <id> [--file PATH]` — prints the entry JSON. Exits 1 if not found.
- `update <id> [--status X] [--notes "..."] [--draftPath "..."] [--file PATH]` — patches a single entry. Prints the updated entry JSON.

All subcommands print JSON only on stdout; human-readable messages go to stderr.

- [ ] **Step 1: Write the failing test**

Create `tests/blog-backlog/cli.test.js`:

```javascript
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
    await fs.writeFile(planFile, JSON.stringify({
      new: [{
        title: 'Hello world', hook: 'a hook', audience: 'en-tech',
        targetLength: 1000, supporting: [{ type: 'pr', number: 7 }],
        rationale: 'because',
      }],
      merge: [],
      skip: [],
      cursor: { pr: 7 },
    }));
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
    await fs.writeFile(planFile, JSON.stringify({
      new: [{
        title: 'X', hook: 'h', audience: 'en-tech',
        targetLength: 1000, supporting: [{ type: 'pr', number: 1 }], rationale: '',
      }],
      merge: [], skip: [], cursor: {},
    }));
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
    await fs.writeFile(planFile, JSON.stringify({
      new: [{
        title: 'X', hook: 'h', audience: 'en-tech',
        targetLength: 1000, supporting: [{ type: 'pr', number: 1 }], rationale: '',
      }],
      merge: [], skip: [], cursor: {},
    }));
    run(['apply', '--plan', planFile, '--file', file]);
    const reloaded = JSON.parse(await fs.readFile(file, 'utf-8'));
    const id = reloaded.entries[0].id;

    const out = run(['update', id, '--status', 'greenlit', '--notes', 'do this one', '--file', file]);
    const updated = JSON.parse(out);
    expect(updated.status).toBe('greenlit');
    expect(updated.notes).toBe('do this one');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run tests/blog-backlog/cli.test.js`
Expected: FAIL — CLI file not found.

- [ ] **Step 3: Write the CLI**

Create `scripts/blog-backlog/cli.js`:

```javascript
#!/usr/bin/env node

/**
 * cli.js -- Blog backlog CLI for A Los Traques
 *
 * Subcommands: init, cursor, apply, get, update
 * All commands print JSON to stdout; logs go to stderr.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadBacklog, saveBacklog, emptyBacklog } from './backlog.js';
import { applyPlan } from './dedup.js';

const DEFAULT_FILE = path.resolve(process.cwd(), 'docs/blog-backlog.json');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function cmdInit(file) {
  try {
    await fs.access(file);
    process.stderr.write(`backlog: ${file} already exists, no-op\n`);
    return;
  } catch {}
  await fs.mkdir(path.dirname(file), { recursive: true });
  await saveBacklog(file, emptyBacklog());
  process.stderr.write(`backlog: initialised ${file}\n`);
}

async function cmdCursor(file) {
  const b = await loadBacklog(file);
  process.stdout.write(`${JSON.stringify(b.cursor)}\n`);
}

async function cmdApply(file, planPath) {
  const planRaw = await fs.readFile(planPath, 'utf-8');
  const plan = JSON.parse(planRaw);
  const backlog = await loadBacklog(file);
  const summary = applyPlan(backlog, plan, new Date().toISOString());
  await saveBacklog(file, backlog);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

async function cmdGet(file, id) {
  const backlog = await loadBacklog(file);
  const entry = backlog.entries.find((e) => e.id === id);
  if (!entry) {
    process.stderr.write(`backlog: entry "${id}" not found\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

async function cmdUpdate(file, id, flags) {
  const backlog = await loadBacklog(file);
  const entry = backlog.entries.find((e) => e.id === id);
  if (!entry) {
    process.stderr.write(`backlog: entry "${id}" not found\n`);
    process.exit(1);
  }
  if (flags.status !== undefined) entry.status = flags.status;
  if (flags.notes !== undefined) entry.notes = flags.notes;
  if (flags.draftPath !== undefined) entry.draftPath = flags.draftPath;
  await saveBacklog(file, backlog);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const file = path.resolve(flags.file ?? DEFAULT_FILE);

  switch (sub) {
    case 'init':
      return cmdInit(file);
    case 'cursor':
      return cmdCursor(file);
    case 'apply':
      if (!flags.plan) {
        process.stderr.write('apply: --plan PATH is required\n');
        process.exit(2);
      }
      return cmdApply(file, path.resolve(flags.plan));
    case 'get':
      return cmdGet(file, positional[0]);
    case 'update':
      return cmdUpdate(file, positional[0], flags);
    default:
      process.stderr.write(`usage: cli.js {init|cursor|apply|get|update} [...]\n`);
      process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`backlog: ${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run tests/blog-backlog/cli.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-backlog/cli.js tests/blog-backlog/cli.test.js
git commit -m "feat(blog-backlog): cli with init/cursor/apply/get/update"
```

---

## Task 5: Bootstrap empty backlog and drafts directory

**Files:**
- Create: `docs/blog-backlog.json`
- Create: `apps/web/content/blog/_drafts/.gitkeep`

Use the CLI itself to bootstrap so the file format is guaranteed correct.

- [ ] **Step 1: Bootstrap the backlog**

Run: `node scripts/blog-backlog/cli.js init`
Expected stderr: `backlog: initialised /Users/.../docs/blog-backlog.json`.

- [ ] **Step 2: Verify the file**

Run: `cat docs/blog-backlog.json`
Expected:
```json
{
  "version": 1,
  "cursor": {
    "pr": 0,
    "rfc": "",
    "transcript": "1970-01-01T00:00:00Z"
  },
  "entries": []
}
```

- [ ] **Step 3: Create drafts directory placeholder**

```bash
mkdir -p apps/web/content/blog/_drafts
touch apps/web/content/blog/_drafts/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add docs/blog-backlog.json apps/web/content/blog/_drafts/.gitkeep
git commit -m "chore(blog-backlog): bootstrap empty backlog and drafts directory"
```

---

## Task 6: Define the `pr-miner` subagent

**Files:**
- Create: `.claude/agents/pr-miner.md`

Claude Code subagent definition. Convention: front-matter with `name`, `description`, optional `tools`, then the prompt body. The orchestrator dispatches via `Agent({ subagent_type: 'pr-miner', prompt: '...' })`.

- [ ] **Step 1: Write the subagent**

Create `.claude/agents/pr-miner.md`:

```markdown
---
name: pr-miner
description: Mines merged PRs in the A Los Traques repo for blog-post candidates. Reads PRs above a given cursor, judges interestingness, and returns a JSON candidate list. Use only from the /blog-mine orchestrator.
tools: Bash, Read
---

# pr-miner

You scan merged PRs above a cursor and return blog-post candidate ideas as JSON. You do **not** read code beyond what `gh` returns. Your job is to triage signal, not verify.

## Inputs (from the orchestrator prompt)

- `since_pr_number` — only consider PRs with number strictly greater than this.
- `repo_path` — absolute path to the working tree.

## Steps

1. List candidate PRs:

   ```bash
   gh pr list --state merged --limit 200 --json number,title,body,mergedAt,files,author --search "is:merged sort:created-asc"
   ```

   Filter client-side to `number > since_pr_number`. Sort ascending.

2. For each PR, read just enough to decide: title + body + file list. Skim review comments only when the PR feels promising:

   ```bash
   gh pr view <N> --json title,body,files,reviewComments,mergedAt,baseRefName,headRefName
   ```

3. Judge interestingness against these themes (in priority order):

   - **Rollback netcode** (frame skipping, prediction pruning, desync detection, asymmetric RTT)
   - **Simulation determinism** (FixedPoint math, event-driven presentation, FightRecorder, checksums)
   - **AI asset generation** (Gemini pipeline, pose estimation, accessory calibration, prompt engineering)
   - **RFC-driven workflow** (RFC referenced in body, multi-phase rollout, design-then-build cadence)
   - **Multiplayer debuggability** (Logger, telemetry, debug bundles, diagnostics endpoint)
   - **Asset pipeline plumbing** (build hooks, manifest generation, calibration tooling)
   - **Gnarly bug stories** (root cause was non-obvious, fix was small relative to debugging)
   - **Process / tooling** (Claude skills, GitHub Actions for @claude, code-review skill)

   **Skip:** routine fixes, lint/format-only PRs, dependency bumps, copy edits, single-file UI tweaks without a story.

4. For each interesting PR, emit a candidate object. **Pick `audience`** based on the topic:
   - Friends-Spanish if the story is project-internal (a friend's fighter rebalance, a UI in-joke, a "the time we broke X right before the party").
   - Tech-English for generalizable engineering content (rollback, determinism, AI dev workflow).
   - Use `both` only when the topic genuinely lands in both audiences.

5. Output **only** a JSON array on stdout, no prose, no markdown fences. Schema per item:

   ```json
   {
     "title": "Rollback netcode: why we kill audio during resimulation",
     "hook": "GGPO-style rollback re-runs the simulation up to 7 frames per misprediction. Naive code re-fires every hit-spark and KO sound. Here's the event-bus refactor that fixed it.",
     "audience": "en-tech",
     "targetLength": 1800,
     "supporting": [{ "type": "pr", "number": 91 }],
     "rationale": "Concrete bug → architectural fix → generalizable lesson."
   }
   ```

6. Also emit the new cursor (highest PR number you scanned) on the very last line as JSON:

   ```json
   {"_cursor": {"pr": 151}}
   ```

## Voice for `hook`

- One to three sentences. Lead with the surprising fact or the concrete bug, not "in this post we will".
- Tech audience: code over prose, file:line refs welcome.
- Friends audience: warm, first-person plural ("hicimos", "decidimos").

## Hard constraints

- No prose outside the JSON array and the `_cursor` line.
- `targetLength`: 300–600 for friends, 1200–2500 for tech.
- Never invent PR numbers; every entry must reference a PR you actually read.
- Do not write to disk. The orchestrator handles persistence.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `head -5 .claude/agents/pr-miner.md`
Expected: starts with `---` frontmatter block.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/pr-miner.md
git commit -m "feat(blog-mine): add pr-miner subagent"
```

---

## Task 7: Define the `rfc-miner` subagent

**Files:**
- Create: `.claude/agents/rfc-miner.md`

- [ ] **Step 1: Write the subagent**

Create `.claude/agents/rfc-miner.md`:

```markdown
---
name: rfc-miner
description: Mines docs/rfcs/*.md in the A Los Traques repo for blog-post candidates. Reads RFCs above a given cursor, classifies how each could become a post (lift-and-edit, pair-with-PR, too-dry-to-stand-alone), and returns a JSON candidate list. Use only from the /blog-mine orchestrator.
tools: Bash, Read
---

# rfc-miner

You scan RFC files in `docs/rfcs/` above a cursor and return blog-post candidates.

## Inputs (from the orchestrator prompt)

- `since_rfc_filename` — only consider RFC filenames lexicographically greater than this. Pass empty string to scan all.
- `repo_path` — absolute path to the working tree.

## Steps

1. List RFC files:

   ```bash
   ls docs/rfcs/*.md
   ```

   Filter to filenames > `since_rfc_filename`. Sort ascending.

2. For each RFC, read the full file (they are typically <500 lines):

   ```bash
   cat docs/rfcs/<file>
   ```

3. Classify each RFC:

   - **lift-and-edit**: RFC is already a near-complete narrative (problem → design → implementation notes) and could become a post with editing. Most of yours fall here.
   - **pair-with-PR**: RFC is a design doc; the post needs the implementation reality from the PR. Emit a candidate with `supporting` referencing both the RFC and a relevant PR if you can identify one from the RFC body or status. Otherwise leave `supporting` to just the RFC and note in `rationale` that pairing is needed.
   - **too-dry**: pure infrastructure / process RFC with no narrative arc (skip it).

4. For each non-skip RFC, emit a candidate. Match RFC topic to audience:
   - Most RFCs are tech-English material.
   - Process/workflow RFCs (e.g., "we adopted RFCs", "AI dev workflow") can be `both`.

5. Output a JSON array on stdout (no prose, no fences), and the cursor on the final line:

   ```json
   {"_cursor": {"rfc": "0019-nextjs-monorepo-restructure.md"}}
   ```

   Cursor = lexicographically greatest filename you scanned.

## Schema per item

```json
{
  "title": "Why we wrote 19 RFCs for a friends' fighting game",
  "hook": "...",
  "audience": "en-tech",
  "targetLength": 2000,
  "supporting": [{ "type": "rfc", "ref": "0019-nextjs-monorepo-restructure.md" }],
  "rationale": "Lift-and-edit; the RFC is already structured as problem→design→phases."
}
```

## Hard constraints

- No prose outside the JSON array and the `_cursor` line.
- `supporting[].type` for RFCs is `"rfc"` and `ref` is the bare filename (no `docs/rfcs/` prefix).
- Do not write to disk.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/agents/rfc-miner.md
git commit -m "feat(blog-mine): add rfc-miner subagent"
```

---

## Task 8: Define the `transcript-miner` subagent

**Files:**
- Create: `.claude/agents/transcript-miner.md`

- [ ] **Step 1: Write the subagent**

Create `.claude/agents/transcript-miner.md`:

```markdown
---
name: transcript-miner
description: Mines Claude Code session transcripts (JSONL) for blog-post candidates about AI-assisted development on A Los Traques. Reads sessions newer than a cursor across both personal and standard Claude installs, joins to PRs by worktree slug when possible. Use only from the /blog-mine orchestrator.
tools: Bash, Read
---

# transcript-miner

You scan Claude Code transcript JSONL files for AI-dev meta-stories: prompts that worked vs didn't, multi-agent designs, hard-to-debug agent behaviors, the RFC-driven workflow in action, the "we built an agent team to do X" pattern.

## Inputs (from the orchestrator prompt)

- `since_transcript_mtime` — ISO timestamp; only consider files with mtime > this.
- Transcript roots:
  - `~/.claude-personal/projects/` (primary, `CLAUDE_CONFIG_DIR=~/.claude-personal`)
  - `~/.claude/projects/` (standard install, occasional accidental use)

## Steps

1. List transcript files for this project from both roots:

   ```bash
   find ~/.claude-personal/projects -path '*a-los-traques*' -name '*.jsonl' -newermt <since> 2>/dev/null
   find ~/.claude/projects -path '*a-los-traques*' -name '*.jsonl' -newermt <since> 2>/dev/null
   ```

2. For each session file, the directory name encodes the worktree:

   - `-Users-simon-personal-a-los-traques` → main repo, no worktree.
   - `-Users-simon-personal-a-los-traques--claude-worktrees-<slug>` → worktree `<slug>`.

3. Each JSONL file may be large. Read in chunks; do not load entire transcripts into context if a file exceeds ~2000 lines:

   ```bash
   wc -l <file>
   head -200 <file>          # initial setup, user prompt
   tail -400 <file>          # final outcome, what shipped
   ```

   Sample middle chunks only if the start/end signal something interesting.

4. Look for these meta-story patterns:

   - **Multi-agent designs**: brainstorming an agent team (like this very feature).
   - **Prompt iteration**: a skill that needed three rewrites before it stopped misfiring.
   - **Hard agent debugging**: an agent that confidently produced wrong output; how it got caught.
   - **RFC-driven cadence**: spec → plan → execution loops, esp. when the spec changed mid-flight.
   - **Tooling discoveries**: skills, hooks, slash commands, subagent dispatch patterns.
   - **Notable failures**: a session that wasted hours on the wrong thing.

5. Try to join sessions to PRs: search the worktree slug against PR head branches:

   ```bash
   gh pr list --state merged --limit 200 --json number,headRefName --search "is:merged"
   ```

   If the slug matches `worktree-<branch>`, link the candidate's `supporting` to that PR.

6. Output a JSON array on stdout (no prose, no fences) plus a cursor line:

   ```json
   {"_cursor": {"transcript": "2026-05-01T16:00:00Z"}}
   ```

   Cursor = ISO timestamp of the newest transcript file mtime you scanned.

## Schema per item

```json
{
  "title": "Designing an agent team to suggest blog posts about an agent-team-built game",
  "hook": "We have 19 RFCs and 30 PRs of source material and zero blog posts. So we designed five agents to do the triage.",
  "audience": "en-tech",
  "targetLength": 2200,
  "supporting": [
    { "type": "transcript", "ref": "/Users/simon/.claude-personal/projects/.../<sessionid>.jsonl" }
  ],
  "rationale": "Meta-story about using subagent dispatch + brainstorming skill to design tooling for the project."
}
```

When you can join to a PR, include both refs:

```json
"supporting": [
  { "type": "transcript", "ref": "..." },
  { "type": "pr", "number": 132 }
]
```

## Hard constraints

- No prose outside the JSON array and the `_cursor` line.
- `transcript.ref` is the absolute path to the JSONL file.
- Do not write to disk.
- If a session is mostly noise (failed attempts, debugging an unrelated tool), skip it.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/agents/transcript-miner.md
git commit -m "feat(blog-mine): add transcript-miner subagent"
```

---

## Task 9: Define the `blog-drafter` subagent

**Files:**
- Create: `.claude/agents/blog-drafter.md`

- [ ] **Step 1: Write the subagent**

Create `.claude/agents/blog-drafter.md`:

```markdown
---
name: blog-drafter
description: Expands a single blog backlog entry into a draft Markdown post under apps/web/content/blog/_drafts/. Reads supporting refs (PRs, RFCs, transcripts, code) to verify claims and quote accurately. Voice depends on the entry's audience tag. Use only from the /blog-expand orchestrator.
tools: Bash, Read, Write, Grep
---

# blog-drafter

You expand one backlog entry into a draft Markdown post. The orchestrator passes you the entry JSON and the path to write to.

## Inputs (from the orchestrator prompt)

- The full entry JSON.
- `draft_path` — relative path under `apps/web/content/blog/_drafts/<slug>.md`.

## Steps

1. Read every `supporting` ref:

   - `pr` → `gh pr view <N> --json title,body,files,reviewComments,commits` then `gh pr diff <N> | head -300`.
   - `rfc` → `cat docs/rfcs/<ref>`.
   - `commit` → `git show <sha> --stat` then `git show <sha> -- <file>` for relevant files.
   - `code` → `Read` the file (slice if large).
   - `transcript` → `head -200` and `tail -400` of the JSONL; sample middle chunks if needed.

2. **Verify claims against source code, not PR descriptions.** PR descriptions can be wrong or out of date. If a claim in the hook is contradicted by the code, prefer the code and adjust the post.

3. Write the post to `draft_path` with frontmatter:

   ```markdown
   ---
   title: "<title>"
   date: "TBD"
   summary: "<one-sentence summary>"
   audience: "<es-friends|en-tech|both>"
   status: "draft"
   ---
   ```

4. Apply voice rules per `audience`:

   ### es-friends
   - Warm, casual, project-diary. In-jokes about friends-as-fighters welcome.
   - Short paragraphs. First-person plural ("hicimos", "decidimos", "nos rompimos").
   - 300–600 words.
   - Reference one-shot: read `apps/web/content/blog/welcome.md` for tone.

   ### en-tech
   - Concrete, no-fluff, code over prose. Julia Evans / Dan Luu vibe.
   - Lead with the bug or surprising fact, not "in this post we will".
   - Short paragraphs, code blocks with `file:line` refs, no apology paragraphs.
   - 1200–2500 words.

   ### both
   - Pick the primary language from the source material (most RFCs are English; transcripts are mixed).
   - Lean tech-English voice. The other language is produced by a separate `/blog-expand` run after manually flipping the audience tag (out of scope here).

5. **Honor `notes`** as steering. Examples: "lead with the bug, not the architecture", "skip the merge timeline", "pair with PR #97 for the asymmetric variant". Notes override your own structural instincts.

6. Add a "Sources" section at the end listing the supporting refs as links:
   - PRs: `[#N — title](https://github.com/<owner>/<repo>/pull/N)` (find owner/repo via `gh repo view --json nameWithOwner -q .nameWithOwner`).
   - RFCs: relative link `[<filename>](../docs/rfcs/<filename>)`.
   - Code: `[<path>](../<path>#L<line>)`.
   - Transcripts: do **not** link (they're local files); list as plain text.

7. Print to stdout the relative path you wrote: `apps/web/content/blog/_drafts/<slug>.md`. No other output.

## Hard constraints

- Do not modify `docs/blog-backlog.json` — the orchestrator does that.
- Do not move files out of `_drafts/`.
- Never invent code, file paths, line numbers, or PR numbers. Always quote from what you read.
- If you can't verify a claim, soften it ("I think", "from the diff it looks like") or drop it.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/agents/blog-drafter.md
git commit -m "feat(blog-expand): add blog-drafter subagent"
```

---

## Task 10: `/blog-mine` slash command

**Files:**
- Create: `.claude/skills/blog-mine/SKILL.md`

This is the orchestrator. It runs in the main thread, dispatches the three miners in parallel, runs LLM-judged dedup, calls `cli.js apply` to write back.

- [ ] **Step 1: Write the skill**

Create `.claude/skills/blog-mine/SKILL.md`:

````markdown
---
name: blog-mine
description: Run the blog-post backlog miner. Reads the cursor in docs/blog-backlog.json, dispatches pr-miner / rfc-miner / transcript-miner in parallel, runs LLM-judged dedup against existing entries, and writes the updated backlog. Incremental — only scans material since the last run. Use when the user types /blog-mine or asks to "find new blog ideas", "scan PRs for posts", "update the backlog".
---

# /blog-mine

Mine new blog-post ideas from PRs, RFCs, and Claude Code transcripts.

## Workflow

### 1. Bootstrap

```bash
node scripts/blog-backlog/cli.js init
```

(no-op if the backlog already exists).

### 2. Read the current cursor

```bash
node scripts/blog-backlog/cli.js cursor
```

The output is a JSON object like `{"pr": 151, "rfc": "0019-nextjs-monorepo-restructure.md", "transcript": "2026-05-01T16:00:00Z"}`.

### 3. Read the existing backlog (for dedup judgment)

```bash
cat docs/blog-backlog.json
```

You'll need the existing entries' `id`, `title`, `hook`, `supporting`, `status` to judge dedup. Do **not** consider entries with `status: "rejected"` for merging — they're suppressed forever — but **do** consider them for skip-suggestion (don't re-suggest a rejected idea).

### 4. Dispatch the three miners in parallel

Use a single message with three Agent tool calls (see "## Using your tools" in the system prompt — independent calls go in one message).

```
Agent({ subagent_type: "pr-miner", prompt: "since_pr_number=<N>, repo_path=<cwd>. <full pr-miner prompt>" })
Agent({ subagent_type: "rfc-miner", prompt: "since_rfc_filename=<F>, repo_path=<cwd>. <full rfc-miner prompt>" })
Agent({ subagent_type: "transcript-miner", prompt: "since_transcript_mtime=<T>. <full transcript-miner prompt>" })
```

Each subagent returns its candidate JSON array + `_cursor` line on stdout (in its final message).

### 5. Parse miner outputs

Each miner's last message ends with a `_cursor` JSON line. Strip it from the candidates array. Aggregate all candidates from all three miners into one list.

### 6. Run LLM-judged dedup against the existing backlog

For each candidate, decide one of:

- **`new`** — no existing entry covers this material.
- **`merge` into `<id>`** — an existing entry covers the same story (semantic overlap on title+hook, OR overlapping `supporting` set, OR clear topical match). Pick the existing entry whose scope subsumes this candidate.
- **`skip`** — exact dup of an existing rejected entry, or this candidate is too thin to add value.

**Mechanical rule (always applies first):** if a candidate's `supporting` set has a PR# or RFC ref already present in any non-rejected entry, default to merge into that entry unless the title/hook clearly indicate a different story.

### 7. Build the merge plan

```json
{
  "new": [<candidate>, ...],
  "merge": [{ "intoId": "<existing-id>", "candidate": <candidate> }, ...],
  "skip": [<candidate>, ...],
  "cursor": {
    "pr": <highest pr scanned>,
    "rfc": "<lexicographically last rfc scanned>",
    "transcript": "<latest transcript mtime scanned>"
  }
}
```

Write to a temp file:

```bash
cat > /tmp/blog-mine-plan.json <<'EOF'
<plan json>
EOF
```

### 8. Apply the plan

```bash
node scripts/blog-backlog/cli.js apply --plan /tmp/blog-mine-plan.json
```

Output is `{"added": N, "merged": M, "skipped": K, "cursor": {...}}`.

### 9. Report

Tell the user:

- N new entries added (list titles).
- M existing entries had refs merged in (list ids + titles).
- K candidates skipped.
- New cursor.
- Suggest: "Review `docs/blog-backlog.json`. Edit `status: greenlit` on ones you want, `status: rejected` on ones you don't, and use `notes:` to steer the drafter. Run `/blog-expand <id>` to draft a post."

## Failure modes

- **A miner returns malformed JSON** → log to the user, skip that miner's output, continue with the others. Do not abort.
- **`gh` not authenticated** → tell the user `gh auth login` is needed for pr-miner.
- **No new material since last cursor** → all three miners return empty arrays. Print "Nothing new since last run." and exit without writing.

## Hard constraints

- Never edit `docs/blog-backlog.json` directly. Always go through `cli.js apply`.
- Never edit the `status` or `notes` fields of existing entries during a merge — those are user-owned.
- Do not call `/blog-expand` automatically. The user picks which ideas to expand.
````

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/blog-mine/SKILL.md
git commit -m "feat(blog-mine): add /blog-mine slash command orchestrator"
```

---

## Task 11: `/blog-expand` slash command

**Files:**
- Create: `.claude/skills/blog-expand/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `.claude/skills/blog-expand/SKILL.md`:

````markdown
---
name: blog-expand
description: Expand a single blog backlog entry into a draft Markdown post under apps/web/content/blog/_drafts/. Reads supporting refs (PRs, RFCs, transcripts, code) to verify claims. Use when the user types /blog-expand <id> or asks to "draft the post about X", "expand backlog entry Y", "write the rollback post".
---

# /blog-expand

Expand one backlog entry into a draft post.

## Workflow

### 1. Resolve the id

The user passes an id as the slash command argument (e.g. `/blog-expand rollback-resimulation-events-2a3f`).

If no id is provided, list `proposed` and `greenlit` entries with their ids and ask the user which to expand.

### 2. Fetch the entry

```bash
node scripts/blog-backlog/cli.js get <id>
```

If the CLI exits non-zero, the id is wrong. Suggest the closest matches by listing `id`s from `cat docs/blog-backlog.json`.

### 3. Refuse on bad status

- `status: rejected` → refuse: "this entry is rejected; flip status to `proposed` if you want to resurrect it."
- `status: published` → refuse.
- `status: drafted` → ask the user explicitly: "draft already exists at `<draftPath>`. Overwrite? (yes/no)"

### 4. Compute draft path

```
apps/web/content/blog/_drafts/<id>.md
```

### 5. Dispatch the drafter subagent

```
Agent({
  subagent_type: "blog-drafter",
  prompt: `Entry: <full entry JSON>. draft_path: apps/web/content/blog/_drafts/<id>.md. <full blog-drafter prompt>`
})
```

The drafter writes the file directly and returns the relative path on stdout.

### 6. Update the backlog

```bash
node scripts/blog-backlog/cli.js update <id> --status drafted --draftPath "apps/web/content/blog/_drafts/<id>.md"
```

### 7. Report to the user

- Path to the draft.
- Word count: `wc -w apps/web/content/blog/_drafts/<id>.md`.
- Reminder: drafts under `_drafts/` are not picked up by `apps/web/lib/blog.ts`. Move the file up one directory and set `date:` (replacing `TBD`) when ready to publish.

## Failure modes

- **Drafter writes nothing** → don't update the backlog. Report the failure.
- **Path collision** with an existing draft → covered by the `drafted` status check above.

## Hard constraints

- Don't move the draft out of `_drafts/`. Publication is a manual step.
- Don't change `audience`, `notes`, `rationale`, or `supporting` on the entry.
- Don't overwrite without explicit consent.
````

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/blog-expand/SKILL.md
git commit -m "feat(blog-expand): add /blog-expand slash command orchestrator"
```

---

## Task 12: Lint check + final test sweep

- [ ] **Step 1: Run all backlog tests**

Run: `bun run test:run tests/blog-backlog/`
Expected: PASS — all tests across backlog.test.js, id.test.js, dedup.test.js, cli.test.js.

- [ ] **Step 2: Lint**

Run: `bun run lint:fix && bun run lint`
Expected: clean exit. If Biome flags new files, accept formatting changes via `lint:fix`.

- [ ] **Step 3: Commit lint fixes if any**

```bash
git status
# if any formatting changes:
git add -A && git commit -m "chore: apply biome formatting"
```

---

## Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Add a section under "Documentation" so future sessions know the blog backlog system exists.

- [ ] **Step 1: Read current CLAUDE.md "Documentation" section**

```bash
grep -n "^## Documentation" CLAUDE.md
```

Note the line number so you can append after the existing list.

- [ ] **Step 2: Append the new section**

Insert this block after the "Documentation" section's RFC list (before the "## Balance Simulation" header):

```markdown
## Blog Backlog

A five-agent system mines this repo's PRs, RFCs, and Claude Code session transcripts for blog-post candidates, deduped into `docs/blog-backlog.json`. Voice and audience are tagged per article (`es-friends`, `en-tech`, or `both`).

- **`/blog-mine`** — incremental scan. Reads the cursor in `docs/blog-backlog.json`, dispatches `pr-miner` / `rfc-miner` / `transcript-miner` in parallel, dedups against existing entries, writes updated backlog. Run after merging interesting PRs.
- **`/blog-expand <id>`** — promote one backlog entry to a draft under `apps/web/content/blog/_drafts/<id>.md`. Drafter reads supporting refs (PR diffs, RFCs, transcripts, code) and verifies claims against source — PR descriptions are hints, not authoritative. Move the draft up one directory + set `date:` to publish.
- **Manual feedback loop**: edit `status` (`proposed | greenlit | rejected | drafted | published`) and `notes` on backlog entries to steer the system. The orchestrator respects user-set fields on merge.
- **Backlog manipulation CLI**: `node scripts/blog-backlog/cli.js {init|cursor|apply|get|update}`. Used internally by the slash commands; safe to call by hand.
- Transcript ingestion reads both `~/.claude-personal/projects/*a-los-traques*` and `~/.claude/projects/*a-los-traques*` (some sessions accidentally landed on the company install).
- Spec: `docs/superpowers/specs/2026-05-01-blog-article-agent-team-design.md`. Plan: `docs/superpowers/plans/2026-05-01-blog-article-agent-team.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): document blog backlog agents and slash commands"
```

---

## Task 14: End-to-end smoke run

This is a manual validation step, not automated. The miners and drafter are prompt artifacts; their behavior is judged by inspection.

- [ ] **Step 1: Run `/blog-mine`**

In the Claude Code session, type `/blog-mine`. Watch:

- Three Agent tool calls dispatched in parallel.
- Each miner returns a JSON array + `_cursor` line.
- Orchestrator builds a merge plan, calls `cli.js apply`.
- Backlog file populated. Summary printed.

**Expected:** at least 5–10 candidate entries from the existing 30+ PRs and 19 RFCs. Cursor advanced to PR #151, RFC `0019-...md`, recent transcript timestamp.

- [ ] **Step 2: Inspect `docs/blog-backlog.json`**

```bash
node scripts/blog-backlog/cli.js cursor
jq '.entries | length' docs/blog-backlog.json
jq '.entries[].title' docs/blog-backlog.json
```

Sanity-check titles, audience tags, supporting refs.

- [ ] **Step 3: Pick one entry and run `/blog-expand <id>`**

Pick a tech-English entry (probably one of the rollback or determinism ones).

```
/blog-expand <id>
```

Watch the drafter dispatch and inspect the resulting `apps/web/content/blog/_drafts/<id>.md`.

- [ ] **Step 4: Pick one friends-Spanish entry and run `/blog-expand <id>`**

Verify voice matches `welcome.md` tone.

- [ ] **Step 5: Re-run `/blog-mine` to verify incremental behavior**

```
/blog-mine
```

**Expected:** "Nothing new since last run." (or near-empty output if any new transcripts landed).

- [ ] **Step 6: Commit the populated backlog and drafts**

```bash
git add docs/blog-backlog.json apps/web/content/blog/_drafts/
git commit -m "chore(blog-backlog): seed backlog from initial /blog-mine run

Includes initial drafts for two entries to validate the /blog-expand
flow end-to-end."
```

---

## Self-Review Checklist

Run through this once after the plan is written.

**Spec coverage:**

- [x] PR mining (Task 6 + 10)
- [x] RFC mining (Task 7 + 10)
- [x] Transcript mining from both Claude install roots (Task 8 + 10)
- [x] Editor-orchestrator with parallel dispatch + dedup (Task 10)
- [x] Drafter with audience-aware voice + verification against source code (Task 9 + 11)
- [x] Backlog JSON schema with status enum (Task 1)
- [x] Stable IDs (Task 2)
- [x] Mechanical dedup + cursor management (Task 3)
- [x] CLI for safe backlog mutation (Task 4)
- [x] Bootstrap + drafts dir (Task 5)
- [x] User feedback loop via status + notes preservation on merge (Task 3 + 9 + 10)
- [x] Concurrent-run lock — **gap, intentionally deferred**: spec mentions a `.lock` file, but `cli.js apply` is a single short atomic write and the slash commands serialize in one Claude Code session. Skip for v1.
- [x] CLAUDE.md update (Task 13)

**Placeholder scan:** none found.

**Type consistency:** ref shapes match across `id.js`, `dedup.js`, miner schemas, drafter input. `audience` enum identical in spec, schema, and agents. CLI flag names (`--file`, `--plan`, `--status`, `--notes`, `--draftPath`) consistent across uses.

**Out-of-scope (called out in spec, intentionally not in plan):**
- GitHub-issue surface
- Auto-translate
- `/schedule` integration
- `last-run-summary.md` artifact
- Concurrent-run lock file (deferred per above)
