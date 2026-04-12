import { beforeEach, describe, expect, it, vi } from 'vitest';
import leaderboardHandler from '../../api/leaderboard.js';

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

describe('Leaderboard API', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'GET',
      headers: { 'x-dev-user-id': 'test-user' },
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.NODE_ENV = 'development';
  });

  it('returns an empty array when no profiles have wins', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await leaderboardHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('returns rows from the database', async () => {
    const rows = [
      { nickname: 'simon', wins: 10, losses: 2, win_rate: 83 },
      { nickname: 'jeka', wins: 8, losses: 4, win_rate: 67 },
    ];
    mockQuery.mockResolvedValue({ rows });

    await leaderboardHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  // Note: SQL correctness (COALESCE, ordering, filtering, LIMIT) is verified
  // by integration tests against a real database. Unit tests here cover the
  // HTTP contract: status codes, response shape, auth, and error handling.

  it('returns 405 for non-GET methods', async () => {
    req.method = 'POST';

    await leaderboardHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method Not Allowed' });
  });

  it('rejects unauthenticated requests', async () => {
    req.headers = {};
    process.env.NODE_ENV = 'production';

    await leaderboardHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 500 on database errors', async () => {
    mockQuery.mockRejectedValue(new Error('Connection lost'));

    await leaderboardHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
