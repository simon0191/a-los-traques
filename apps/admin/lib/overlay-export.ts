/**
 * Admin-side implementation of the RFC 0018 overlay-calibration write endpoint.
 * Ported from the old `scripts/overlay-export-server.js` Vite dev plugin.
 *
 * Only works when the repo filesystem is writable (local dev) — production
 * Vercel functions are read-only, so this endpoint 500s there. That's fine:
 * overlay calibration is a dev-time workflow that commits its output to git.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Writes are only allowed under this prefix, relative to the repo root.
// The consolidated overlay manifest lives here:
//   apps/web/public/assets/overlays/manifest.json
export const WRITE_PREFIXES = ['apps/web/public/assets/overlays/'];

export function isSafeRelativePath(relPath: unknown): relPath is string {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  if (path.isAbsolute(relPath)) return false;
  const normalized = path.posix.normalize(relPath.split(path.sep).join('/'));
  if (normalized.startsWith('../') || normalized === '..') return false;
  if (normalized.includes('/../')) return false;
  return WRITE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

async function writeAtomically(absPath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  await fs.writeFile(tmp, contents);
  await fs.rename(tmp, absPath);
}

type ExportPayload = { path?: unknown; json?: unknown };

export type OverlayExportResult =
  | { ok: true; path: string }
  | { ok: false; status: number; error: string };

export async function loadOverlayJson(
  relPath: string,
  { repoRoot }: { repoRoot: string },
): Promise<{ status: number; body: string | { error: string } }> {
  if (!isSafeRelativePath(relPath)) {
    return { status: 400, body: { error: 'invalid path' } };
  }
  if (!relPath.endsWith('.json')) {
    return { status: 400, body: { error: 'GET only supports .json session files' } };
  }
  const absPath = path.resolve(repoRoot, relPath);
  try {
    const content = await fs.readFile(absPath, 'utf8');
    return { status: 200, body: content };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 404, body: { error: 'not found' } };
    }
    throw err;
  }
}

export async function saveOverlayJson(
  payload: ExportPayload,
  { repoRoot }: { repoRoot: string },
): Promise<OverlayExportResult> {
  const { path: relPath, json } = payload ?? {};
  if (!isSafeRelativePath(relPath)) {
    return { ok: false, status: 400, error: 'invalid path' };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, status: 400, error: 'must provide json payload' };
  }
  const absPath = path.resolve(repoRoot, relPath);
  await writeAtomically(absPath, `${JSON.stringify(json, null, 2)}\n`);
  return { ok: true, path: relPath };
}
