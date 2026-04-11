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

  it('query uses COALESCE for null nicknames', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await leaderboardHandler(req, res);

    const sqlUsed = mockQuery.mock.calls[0][0];
    expect(sqlUsed).toContain("COALESCE(nickname, 'Anónimo')");
  });

  it('query orders by wins DESC then win rate DESC', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await leaderboardHandler(req, res);

    const sqlUsed = mockQuery.mock.calls[0][0];
    expect(sqlUsed).toMatch(/ORDER BY[\s\S]*wins DESC/);
    expect(sqlUsed).toMatch(/\(wins::numeric \/ \(wins \+ losses\)\) DESC/);
  });

  it('query excludes players with 0 wins', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await leaderboardHandler(req, res);

    const sqlUsed = mockQuery.mock.calls[0][0];
    expect(sqlUsed).toContain('WHERE wins > 0');
  });

  it('query limits results to 10', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await leaderboardHandler(req, res);

    const sqlUsed = mockQuery.mock.calls[0][0];
    expect(sqlUsed).toContain('LIMIT 10');
  });

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
