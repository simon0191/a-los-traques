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
    const summary = applyPlan(
      backlog,
      {
        new: [candidate()],
        merge: [],
        skip: [],
        cursor: { pr: 42 },
      },
      NOW,
    );
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

    applyPlan(
      backlog,
      {
        new: [],
        merge: [
          {
            intoId: 'existing-aaaa',
            candidate: candidate({
              title: 'Different title',
              hook: 'Different hook',
              supporting: [
                { type: 'pr', number: 10 },
                { type: 'rfc', ref: 'X.md' },
              ],
            }),
          },
        ],
        skip: [],
        cursor: {},
      },
      NOW,
    );

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
      id: 'x-aaaa',
      title: 'x',
      hook: 'h',
      audience: 'en-tech',
      targetLength: 100,
      supporting: [{ type: 'pr', number: 1 }],
      status: 'proposed',
      notes: '',
      rationale: '',
      createdAt: NOW,
      lastSeenAt: NOW,
      draftPath: null,
    });
    applyPlan(
      backlog,
      {
        new: [],
        merge: [
          { intoId: 'x-aaaa', candidate: candidate({ supporting: [{ type: 'pr', number: 1 }] }) },
        ],
        skip: [],
        cursor: {},
      },
      NOW,
    );
    expect(backlog.entries[0].supporting).toEqual([{ type: 'pr', number: 1 }]);
  });

  it('throws if merge.intoId does not exist', () => {
    const backlog = emptyBacklog();
    expect(() =>
      applyPlan(
        backlog,
        {
          new: [],
          merge: [{ intoId: 'missing-zzzz', candidate: candidate() }],
          skip: [],
          cursor: {},
        },
        NOW,
      ),
    ).toThrow(/missing-zzzz/);
  });

  it('keeps the higher cursor value for each source', () => {
    const backlog = emptyBacklog();
    backlog.cursor = { pr: 100, rfc: '0050.md', transcript: '2026-04-01T00:00:00Z' };
    applyPlan(
      backlog,
      {
        new: [],
        merge: [],
        skip: [],
        cursor: { pr: 50, rfc: '0099.md', transcript: '2026-04-15T00:00:00Z' },
      },
      NOW,
    );
    expect(backlog.cursor).toEqual({
      pr: 100,
      rfc: '0099.md',
      transcript: '2026-04-15T00:00:00Z',
    });
  });

  it('counts skipped candidates in summary without mutating backlog', () => {
    const backlog = emptyBacklog();
    const summary = applyPlan(
      backlog,
      {
        new: [],
        merge: [],
        skip: [candidate(), candidate()],
        cursor: {},
      },
      NOW,
    );
    expect(summary.skipped).toBe(2);
    expect(backlog.entries).toHaveLength(0);
  });
});
