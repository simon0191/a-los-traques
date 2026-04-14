import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  handleOverlayExport,
  isSafeRelativePath,
} from '../../scripts/overlay-export-server.js';

function makeReq({ method = 'POST', url = '/dev/overlay-export', body = null } = {}) {
  const stream = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  stream.method = method;
  stream.url = url;
  return stream;
}

function makeRes() {
  const chunks = [];
  return {
    statusCode: 0,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(body) {
      if (body !== undefined) chunks.push(body);
      this.body = chunks.join('');
    },
    getBody() {
      try {
        return JSON.parse(this.body);
      } catch {
        return this.body;
      }
    },
  };
}

describe('isSafeRelativePath', () => {
  it('accepts paths under allowed prefixes', () => {
    expect(isSafeRelativePath('public/assets/overlays/cata/hat_walk.png')).toBe(true);
    expect(isSafeRelativePath('assets/overlay-editor/sessions/cata/hat_walk.json')).toBe(true);
  });

  it('rejects path traversal attempts', () => {
    expect(isSafeRelativePath('public/assets/overlays/../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('../public/assets/overlays/x.png')).toBe(false);
    expect(isSafeRelativePath('..')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('/public/assets/overlays/x.png')).toBe(false);
  });

  it('rejects paths outside the allowed prefixes', () => {
    expect(isSafeRelativePath('src/entities/Fighter.js')).toBe(false);
    expect(isSafeRelativePath('package.json')).toBe(false);
  });

  it('rejects non-strings and empty strings', () => {
    expect(isSafeRelativePath(null)).toBe(false);
    expect(isSafeRelativePath(undefined)).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath(42)).toBe(false);
  });
});

describe('handleOverlayExport', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'overlay-export-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects methods other than GET and POST', async () => {
    const res = makeRes();
    await handleOverlayExport(makeReq({ method: 'DELETE' }), res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(405);
  });

  it('rejects writes to unsafe paths', async () => {
    const res = makeRes();
    const req = makeReq({
      body: { path: '../hack.png', base64: 'AAAA' },
    });
    await handleOverlayExport(req, res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(400);
    expect(res.getBody()).toMatchObject({ error: expect.stringMatching(/invalid path/) });
  });

  it('writes a JSON session atomically', async () => {
    const res = makeRes();
    const req = makeReq({
      body: {
        path: 'assets/overlay-editor/sessions/cata/hat_walk.json',
        json: { fighterId: 'cata', frameCount: 4 },
      },
    });
    await handleOverlayExport(req, res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(200);
    const written = await fs.readFile(
      path.join(tmpDir, 'assets/overlay-editor/sessions/cata/hat_walk.json'),
      'utf8',
    );
    expect(JSON.parse(written)).toMatchObject({ fighterId: 'cata', frameCount: 4 });
  });

  it('writes a base64-encoded binary (PNG) payload', async () => {
    const res = makeRes();
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const req = makeReq({
      body: {
        path: 'public/assets/overlays/cata/hat_walk.png',
        base64: pngBytes.toString('base64'),
      },
    });
    await handleOverlayExport(req, res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(200);
    const written = await fs.readFile(path.join(tmpDir, 'public/assets/overlays/cata/hat_walk.png'));
    expect(written.equals(pngBytes)).toBe(true);
  });

  it('creates nested directories as needed', async () => {
    const res = makeRes();
    const req = makeReq({
      body: {
        path: 'public/assets/overlays/new_fighter/new_accessory_idle.png',
        base64: Buffer.from('data').toString('base64'),
      },
    });
    await handleOverlayExport(req, res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(200);
    const dirStat = await fs.stat(path.join(tmpDir, 'public/assets/overlays/new_fighter'));
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('rejects a POST with neither base64 nor json', async () => {
    const res = makeRes();
    const req = makeReq({
      body: { path: 'assets/overlay-editor/sessions/c/h_walk.json' },
    });
    await handleOverlayExport(req, res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(400);
  });

  it('GET returns the session JSON if present', async () => {
    const sessionPath = path.join(tmpDir, 'assets/overlay-editor/sessions/cata/hat_walk.json');
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, JSON.stringify({ fighterId: 'cata', frameCount: 4 }));

    const res = makeRes();
    const req = makeReq({
      method: 'GET',
      url: '/dev/overlay-export?path=assets%2Foverlay-editor%2Fsessions%2Fcata%2Fhat_walk.json',
      body: null,
    });
    await handleOverlayExport(req, res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(200);
    expect(res.getBody()).toMatchObject({ fighterId: 'cata', frameCount: 4 });
  });

  it('GET returns 404 for missing sessions', async () => {
    const res = makeRes();
    const req = makeReq({
      method: 'GET',
      url: '/dev/overlay-export?path=assets%2Foverlay-editor%2Fsessions%2Fno%2Fnope.json',
      body: null,
    });
    await handleOverlayExport(req, res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(404);
  });

  it('GET rejects non-JSON paths', async () => {
    const res = makeRes();
    const req = makeReq({
      method: 'GET',
      url: '/dev/overlay-export?path=public%2Fassets%2Foverlays%2Fcata%2Fhat_walk.png',
      body: null,
    });
    await handleOverlayExport(req, res, { repoRoot: tmpDir });
    expect(res.statusCode).toBe(400);
  });
});
