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
