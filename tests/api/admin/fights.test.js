import { beforeEach, describe, expect, it, vi } from 'vitest';
import adminFightsHandler from '../../../api/admin/fights.js';

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockClient = {
  query: (...args) => mockQuery(...args),
  connect: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};
const mockConnect = vi.fn().mockResolvedValue(mockClient);

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  decodeProtectedHeader: vi.fn(),
  createRemoteJWKSet: vi.fn(),
}));

vi.mock('../../../api/_lib/db.js', () => ({
  createPool: vi.fn().mockImplementation(() => ({
    connect: () => Promise.resolve(mockClient),
  })),
  createClient: vi.fn().mockImplementation(() => mockClient),
}));

const mockListBundles = vi.fn();
vi.mock('../../../api/_lib/storage.js', () => ({
  BUNDLE_TTL_DAYS: 7,
  storage: {
    listBundles: (...args) => mockListBundles(...args),
  },
}));

describe('Admin Fights API', () => {
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
    };
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.NODE_ENV = 'development';
  });

  function mockAdminCheck(isAdmin = true) {
    // First query: is_admin check from withAdmin
    mockQuery.mockResolvedValueOnce({
      rows: isAdmin ? [{ is_admin: true }] : [],
    });
  }

  it('returns paginated fights sorted by started_at DESC', async () => {
    mockAdminCheck();
    // Count query
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
    // Fights query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'f1',
          room_id: 'ABCD',
          p1_fighter: 'simon',
          p2_fighter: 'paula',
          stage_id: 'beach',
          started_at: '2026-04-01T10:00:00Z',
          has_debug_bundle: false,
          p1_nickname: 'Simon',
          p2_nickname: 'Paula',
        },
        {
          id: 'f2',
          room_id: 'EFGH',
          p1_fighter: 'jeko',
          p2_fighter: 'gus',
          stage_id: 'metro',
          started_at: '2026-04-01T09:00:00Z',
          has_debug_bundle: true,
          p1_nickname: 'Jeko',
          p2_nickname: 'Gus',
        },
      ],
    });
    mockListBundles.mockResolvedValueOnce([{ slot: 0, round: 1, key: 'f2/p0_round1.json' }]);

    await adminFightsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const data = res.json.mock.calls[0][0];
    expect(data.fights).toHaveLength(2);
    expect(data.total).toBe(2);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(20);
    // Second fight has bundles
    expect(data.fights[1].bundles).toHaveLength(1);
  });

  it('respects pagination params', async () => {
    mockAdminCheck();
    req.query = { page: '2', limit: '10' };
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '25' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await adminFightsHandler(req, res);

    // Check OFFSET in query
    const selectCall = mockQuery.mock.calls[2]; // 0=admin check, 1=count, 2=select
    expect(selectCall[1]).toEqual([10, 10]); // limit=10, offset=10
    const data = res.json.mock.calls[0][0];
    expect(data.page).toBe(2);
    expect(data.total).toBe(25);
  });

  it('filters by hasDebug=true', async () => {
    mockAdminCheck();
    req.query = { hasDebug: 'true' };
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await adminFightsHandler(req, res);

    // Count query should include WHERE clause
    const countCall = mockQuery.mock.calls[1];
    expect(countCall[0]).toContain('has_debug_bundle = TRUE');
    // Select query should include WHERE clause
    const selectCall = mockQuery.mock.calls[2];
    expect(selectCall[0]).toContain('has_debug_bundle = TRUE');
  });

  it('includes player nicknames from profiles JOIN', async () => {
    mockAdminCheck();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'f1',
          has_debug_bundle: false,
          p1_nickname: 'Simon',
          p2_nickname: 'Paula',
        },
      ],
    });

    await adminFightsHandler(req, res);

    const data = res.json.mock.calls[0][0];
    expect(data.fights[0].p1_nickname).toBe('Simon');
    expect(data.fights[0].p2_nickname).toBe('Paula');
  });

  it('returns 403 for non-admin users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: false }] });

    await adminFightsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 405 for non-GET methods', async () => {
    mockAdminCheck();
    req.method = 'POST';

    await adminFightsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});
