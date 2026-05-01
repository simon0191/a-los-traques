import { describe, expect, it } from 'vitest';
import { makeId, slugify } from '../../scripts/blog-backlog/id.js';

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('strips punctuation', () => {
    expect(slugify('Rollback netcode: why we kill audio!')).toBe(
      'rollback-netcode-why-we-kill-audio',
    );
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
    const a = makeId('Title', [
      { type: 'pr', number: 1 },
      { type: 'rfc', ref: 'X.md' },
    ]);
    const b = makeId('Title', [
      { type: 'pr', number: 1 },
      { type: 'rfc', ref: 'X.md' },
    ]);
    expect(a).toBe(b);
  });
  it('is order-independent on supporting refs', () => {
    const a = makeId('Title', [
      { type: 'pr', number: 1 },
      { type: 'rfc', ref: 'X.md' },
    ]);
    const b = makeId('Title', [
      { type: 'rfc', ref: 'X.md' },
      { type: 'pr', number: 1 },
    ]);
    expect(a).toBe(b);
  });
  it('differs when supporting refs differ', () => {
    const a = makeId('Title', [{ type: 'pr', number: 1 }]);
    const b = makeId('Title', [{ type: 'pr', number: 2 }]);
    expect(a).not.toBe(b);
  });
});
