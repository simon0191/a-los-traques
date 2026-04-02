import { beforeEach, describe, expect, it, vi } from 'vitest';
import debugBundlesHandler from '../../api/debug-bundles.js';

const mockQuery = vi.fn();
const mockConnect = vi.fn(async () => ({
  query: mockQuery,
  release: vi.fn(),
}));

vi.mock('jose');
vi.mock('pg', () => {
  class Pool {
    constructor() {
      this.connect = mockConnect;
    }
  }
  return {
    default: { Pool },
    Pool,
  };
});

const mockUpload = vi.fn();
vi.mock('../../api/_lib/storage.js', () => ({
  BUNDLE_TTL_DAYS: 7,
  storage: {
    uploadBundle: (...args) => mockUpload(...args),
  },
}));

describe('Debug Bundles API', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'POST',
      headers: { 'x-dev-user-id': 'user-1' },
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.NODE_ENV = 'development';
  });

  it('uploads bundle and returns 201', async () => {
    req.body = {
      fightId: 'fight-uuid',
      slot: 0,
      round: 1,
      bundle: { version: 2, source: 'debug' },
    };
    // Fight exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'fight-uuid' }] });
    // Update has_debug_bundle
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockUpload.mockResolvedValueOnce();

    await debugBundlesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockUpload).toHaveBeenCalledWith(
      'fight-uuid',
      0,
      1,
      JSON.stringify({ version: 2, source: 'debug' }),
    );
  });

  it('sets has_debug_bundle and debug_bundle_expires_at on the fight', async () => {
    req.body = {
      fightId: 'fight-uuid',
      slot: 0,
      round: 1,
      bundle: { version: 2 },
    };
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'fight-uuid' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockUpload.mockResolvedValueOnce();

    await debugBundlesHandler(req, res);

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('has_debug_bundle = TRUE');
    expect(updateCall[0]).toContain('debug_bundle_expires_at');
    expect(updateCall[1]).toEqual(['fight-uuid']);
  });

  it('returns 400 when fightId is missing', async () => {
    req.body = { slot: 0, round: 1, bundle: {} };

    await debugBundlesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('returns 400 when slot is missing', async () => {
    req.body = { fightId: 'fight-uuid', round: 1, bundle: {} };

    await debugBundlesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when round is missing', async () => {
    req.body = { fightId: 'fight-uuid', slot: 0, bundle: {} };

    await debugBundlesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when bundle is missing', async () => {
    req.body = { fightId: 'fight-uuid', slot: 0, round: 1 };

    await debugBundlesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when fight does not exist', async () => {
    req.body = {
      fightId: 'nonexistent',
      slot: 0,
      round: 1,
      bundle: { version: 2 },
    };
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await debugBundlesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('returns 401 without auth', async () => {
    req.headers = {};
    req.body = {
      fightId: 'fight-uuid',
      slot: 0,
      round: 1,
      bundle: { version: 2 },
    };

    await debugBundlesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 405 for non-POST methods', async () => {
    req.method = 'GET';

    await debugBundlesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('handles string bundle content', async () => {
    const bundleStr = '{"version":2}';
    req.body = {
      fightId: 'fight-uuid',
      slot: 0,
      round: 1,
      bundle: bundleStr,
    };
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'fight-uuid' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockUpload.mockResolvedValueOnce();

    await debugBundlesHandler(req, res);

    expect(mockUpload).toHaveBeenCalledWith('fight-uuid', 0, 1, bundleStr);
  });
});
