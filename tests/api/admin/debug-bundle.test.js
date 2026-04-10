import { beforeEach, describe, expect, it, vi } from 'vitest';
import adminDebugBundleHandler from '../../../api/admin/debug-bundle.js';

const mockQuery = vi.fn();
const mockClient = {
  query: mockQuery,
  connect: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock('jose');
vi.mock('pg', () => {
  class MockPool {
    async connect() {
      return mockClient;
    }
    async query(...args) {
      return mockQuery(...args);
    }
    async end() {
      return Promise.resolve();
    }
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

const mockDownload = vi.fn();
vi.mock('../../../api/_lib/storage.js', () => ({
  BUNDLE_TTL_DAYS: 7,
  storage: {
    downloadBundle: (...args) => mockDownload(...args),
  },
}));

describe('Admin Debug Bundle API', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'GET',
      headers: { 'x-dev-user-id': 'admin-user' },
      query: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
    };
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.NODE_ENV = 'development';
  });

  function mockAdminCheck(isAdmin = true) {
    mockQuery.mockResolvedValueOnce({
      rows: isAdmin ? [{ is_admin: true }] : [],
    });
  }

  it('returns bundle content for valid params', async () => {
    mockAdminCheck();
    req.query = { fightId: 'fight-uuid', slot: '0', round: '1' };
    const bundleContent = JSON.stringify({ version: 2, source: 'debug' });
    mockDownload.mockResolvedValueOnce(bundleContent);

    await adminDebugBundleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(bundleContent);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('debug-fight-uuid'),
    );
  });

  it('returns 404 for non-existent bundle', async () => {
    mockAdminCheck();
    req.query = { fightId: 'fight-uuid', slot: '0', round: '99' };
    mockDownload.mockResolvedValueOnce(null);

    await adminDebugBundleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 when fightId is missing', async () => {
    mockAdminCheck();
    req.query = { slot: '0', round: '1' };

    await adminDebugBundleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when slot is missing', async () => {
    mockAdminCheck();
    req.query = { fightId: 'fight-uuid', round: '1' };

    await adminDebugBundleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when round is missing', async () => {
    mockAdminCheck();
    req.query = { fightId: 'fight-uuid', slot: '0' };

    await adminDebugBundleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 403 for non-admin users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: false }] });
    req.query = { fightId: 'fight-uuid', slot: '0', round: '1' };

    await adminDebugBundleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 405 for non-GET methods', async () => {
    mockAdminCheck();
    req.method = 'POST';

    await adminDebugBundleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});
