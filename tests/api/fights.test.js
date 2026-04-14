import { beforeEach, describe, expect, it, vi } from 'vitest';
import fightsHandler from '../../api/fights.js';

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockClient = {
  query: (...args) => mockQuery(...args),
  connect: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  decodeProtectedHeader: vi.fn(),
  createRemoteJWKSet: vi.fn(),
}));

vi.mock('../../api/_lib/db.js', () => ({
  createPool: vi.fn().mockImplementation(() => ({
    connect: () => Promise.resolve(mockClient),
  })),
  createClient: vi.fn().mockImplementation(() => mockClient),
}));

describe('Fights API', () => {
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

  describe('POST /api/fights', () => {
    it('creates a fight record with correct fields', async () => {
      req.body = {
        fightId: 'fight-uuid',
        roomId: 'ABCD',
        p1Fighter: 'simon',
        p2Fighter: 'paula',
        stageId: 'beach',
      };
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ id: 'fight-uuid' });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO fights'), [
        'fight-uuid',
        'ABCD',
        'user-1',
        'simon',
        'paula',
        'beach',
      ]);
    });

    it('returns 400 when required fields are missing', async () => {
      req.body = { fightId: 'fight-uuid' };

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 409 on duplicate fightId', async () => {
      req.body = {
        fightId: 'fight-uuid',
        roomId: 'ABCD',
        p1Fighter: 'simon',
        p2Fighter: 'paula',
        stageId: 'beach',
      };
      mockQuery.mockRejectedValueOnce({ code: '23505' });

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 401 without auth', async () => {
      req.headers = {};
      req.body = {
        fightId: 'fight-uuid',
        roomId: 'ABCD',
        p1Fighter: 'simon',
        p2Fighter: 'paula',
        stageId: 'beach',
      };

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('PATCH /api/fights', () => {
    beforeEach(() => {
      req.method = 'PATCH';
    });

    it('registers P2 user from auth', async () => {
      req.body = { fightId: 'fight-uuid', registerP2: true };
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'fight-uuid' }] });

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('p2_user_id'),
        expect.arrayContaining(['user-1', 'fight-uuid']),
      );
    });

    it('updates match result fields', async () => {
      req.body = {
        fightId: 'fight-uuid',
        winnerSlot: 0,
        roundsP1: 2,
        roundsP2: 1,
      };
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'fight-uuid' }] });

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const queryStr = mockQuery.mock.calls[0][0];
      expect(queryStr).toContain('winner_slot');
      expect(queryStr).toContain('ended_at');
      expect(queryStr).toContain('rounds_p1');
      expect(queryStr).toContain('rounds_p2');
    });

    it('returns 404 for non-existent fightId', async () => {
      req.body = { fightId: 'nonexistent', winnerSlot: 0 };
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when fightId is missing', async () => {
      req.body = { winnerSlot: 0 };

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when no fields to update', async () => {
      req.body = { fightId: 'fight-uuid' };

      await fightsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  it('returns 405 for unsupported methods', async () => {
    req.method = 'DELETE';

    await fightsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});
