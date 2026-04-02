import { beforeEach, describe, expect, it, vi } from 'vitest';
import statsHandler from '../../api/stats.js';

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

describe('Stats API', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'POST',
      headers: { 'x-dev-user-id': 'test-user' },
      body: { isWin: true },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.NODE_ENV = 'development';
  });

  it('increments wins on isWin: true', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ wins: 1, losses: 0 }],
    });

    await statsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ wins: 1, losses: 0 });
  });

  it('increments losses on isWin: false', async () => {
    req.body.isWin = false;
    mockQuery.mockResolvedValue({
      rows: [{ wins: 0, losses: 1 }],
    });

    await statsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ wins: 0, losses: 1 });
  });

  it('returns 404 if profile missing', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await statsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Profile not found' });
  });
});
