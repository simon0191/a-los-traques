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
