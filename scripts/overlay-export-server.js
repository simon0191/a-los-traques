/**
 * Vite dev plugin — POST /dev/overlay-export for the RFC 0018 sprite overlay editor.
 *
 * Only registered in `serve` mode, so production builds don't expose it. Atomic
 * writes (tmp + rename). Path traversal is rejected; writes are constrained to
 * the two known overlay directories.
 *
 * Also handles GET /dev/overlay-export?path=... so the editor can reload a
 * previously-saved session without shipping a separate endpoint.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Writes are only allowed under these prefixes (relative to the repo root).
const WRITE_PREFIXES = ['public/assets/overlays/', 'assets/overlay-editor/sessions/'];

export function isSafeRelativePath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  if (path.isAbsolute(relPath)) return false;
  // Normalize and guard against traversal and backslash escapes.
  const normalized = path.posix.normalize(relPath.split(path.sep).join('/'));
  if (normalized.startsWith('../') || normalized === '..') return false;
  if (normalized.includes('/../')) return false;
  return WRITE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

async function readJsonBody(req, maxBytes = 20 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('payload too large');
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  return JSON.parse(buf.toString('utf8'));
}

async function writeAtomically(absPath, contents) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  await fs.writeFile(tmp, contents);
  await fs.rename(tmp, absPath);
}

function respond(res, status, body) {
  res.statusCode = status;
  if (typeof body === 'object') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  } else {
    res.end(body ?? '');
  }
}

/**
 * Route handler, extracted so tests can exercise it without Vite.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {object} opts
 * @param {string} opts.repoRoot absolute path to the repo root
 * @param {(p: string) => boolean} [opts.isSafe] override for tests
 */
export async function handleOverlayExport(req, res, { repoRoot, isSafe = isSafeRelativePath }) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const relPath = url.searchParams.get('path');
      if (!relPath || !isSafe(relPath)) {
        return respond(res, 400, { error: 'invalid path' });
      }
      if (!relPath.endsWith('.json')) {
        return respond(res, 400, { error: 'GET only supports .json session files' });
      }
      const absPath = path.resolve(repoRoot, relPath);
      try {
        const content = await fs.readFile(absPath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        return res.end(content);
      } catch (err) {
        if (err.code === 'ENOENT') return respond(res, 404, { error: 'not found' });
        throw err;
      }
    }

    if (req.method !== 'POST') {
      return respond(res, 405, { error: 'method not allowed' });
    }

    const body = await readJsonBody(req);
    const { path: relPath, base64, json } = body ?? {};
    if (!isSafe(relPath)) {
      return respond(res, 400, { error: 'invalid path' });
    }
    const absPath = path.resolve(repoRoot, relPath);

    if (typeof base64 === 'string') {
      await writeAtomically(absPath, Buffer.from(base64, 'base64'));
    } else if (json && typeof json === 'object') {
      await writeAtomically(absPath, `${JSON.stringify(json, null, 2)}\n`);
    } else {
      return respond(res, 400, { error: 'must provide base64 (for PNGs) or json (for sessions)' });
    }

    return respond(res, 200, { ok: true, path: relPath });
  } catch (err) {
    return respond(res, 500, { error: String(err.message ?? err) });
  }
}

/**
 * Vite plugin factory. Registers POST/GET /dev/overlay-export in dev mode only.
 */
export function overlayExportPlugin({ repoRoot = process.cwd() } = {}) {
  return {
    name: 'overlay-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev/overlay-export', (req, res) => {
        handleOverlayExport(req, res, { repoRoot });
      });
    },
  };
}
