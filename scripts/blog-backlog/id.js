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
