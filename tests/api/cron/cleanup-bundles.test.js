import { beforeEach, describe, expect, it, vi } from 'vitest';

export const mockQuery = vi.fn();
const mockClient = {
  query: mockQuery,
  connect: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock('pg', () => {
  class MockPool {
    async connect() { return mockClient; }
    async query(...args) { return mockQuery(...args); }
    async end() { return Promise.resolve(); }
  }
  class MockClient {
    constructor() {
      this.query = mockQuery;
      this.connect = mockClient.connect;
      this.end = mockClient.end;
    }
  }
  return {
    default: { Pool: MockPool, Client: MockClient },
    Pool: MockPool,
    Client: MockClient,
  };
});

const mockDeleteBundles = vi.fn();
vi.mock('../../../api/_lib/storage.js', () => ({
  BUNDLE_TTL_DAYS: 7,
  storage: {
    deleteBundles: (...args) => mockDeleteBundles(...args),
  },
}));

import handler from '../../../api/cron/cleanup-bundles.js';

describe('Cleanup Bundles Cron', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'GET',
      headers: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.NODE_ENV = 'development';
    delete process.env.CRON_SECRET;
  });

  it('deletes expired bundles and clears has_debug_bundle', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'fight-1' }, { id: 'fight-2' }],
    });
    // Two update queries (one per fight)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockDeleteBundles.mockResolvedValue();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ deleted: 2, total: 2 });
    expect(mockDeleteBundles).toHaveBeenCalledWith('fight-1');
    expect(mockDeleteBundles).toHaveBeenCalledWith('fight-2');
    // Verify UPDATE was called for each fight
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE fights SET has_debug_bundle = FALSE WHERE id = $1',
      ['fight-1'],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE fights SET has_debug_bundle = FALSE WHERE id = $1',
      ['fight-2'],
    );
  });

  it('handles empty result set gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ deleted: 0 });
    expect(mockDeleteBundles).not.toHaveBeenCalled();
  });

  it('does not touch non-expired fights', async () => {
    // Only returns expired ones (the query handles this)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'expired-1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockDeleteBundles.mockResolvedValue();

    await handler(req, res);

    // Only one fight deleted
    expect(mockDeleteBundles).toHaveBeenCalledTimes(1);
    expect(mockDeleteBundles).toHaveBeenCalledWith('expired-1');
  });

  it('verifies CRON_SECRET when set', async () => {
    process.env.CRON_SECRET = 'my-secret';
    req.headers.authorization = 'Bearer wrong-secret';

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockDeleteBundles).not.toHaveBeenCalled();
  });

  it('allows request with correct CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'my-secret';
    req.headers.authorization = 'Bearer my-secret';
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('skips CRON_SECRET check when not configured', async () => {
    // CRON_SECRET is deleted in beforeEach
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 405 for non-GET methods', async () => {
    req.method = 'POST';

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('continues on individual delete failure', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'fight-ok' }, { id: 'fight-fail' }],
    });
    mockDeleteBundles
      .mockResolvedValueOnce() // fight-ok succeeds
      .mockRejectedValueOnce(new Error('storage error')); // fight-fail fails
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update for fight-ok

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Only 1 successfully deleted
    expect(res.json).toHaveBeenCalledWith({ deleted: 1, total: 2 });
  });
});
