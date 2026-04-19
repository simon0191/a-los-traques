import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB module BEFORE importing handlers
vi.mock('../../api/_lib/db.js', () => ({
  createPool: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    }),
  })),
  createClient: vi.fn(() => ({
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  })),
}));

import { reportMatch } from '../../api/stats/tournament-match.js';
import { createTournament } from '../../api/tournament/create.js';
import { joinTournament } from '../../api/tournament/join.js';

// Mock Response object
const createRes = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
};

describe('Tournament API Endpoints', () => {
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';

    // Setup a clean mock query function for each test
    mockDb = {
      query: vi.fn(),
    };
  });

  const validHostUuid = '11111111-1111-1111-1111-111111111111';
  const validPlayerUuid = '22222222-2222-2222-2222-222222222222';
  const validWinnerUuid = '33333333-3333-3333-3333-333333333333';
  const validLoserUuid = '44444444-4444-4444-4444-444444444444';

  describe('POST /api/tournament/create', () => {
    it('generates a unique 6-char tourneyId', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // collision check
        .mockResolvedValueOnce({ rows: [{ id: 'test-id' }] }) // insert session
        .mockResolvedValueOnce({ rows: [] }); // insert participant

      const req = { method: 'POST' };
      const res = createRes();

      await createTournament(req, res, { userId: validHostUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(201);
      const data = res.json.mock.calls[0][0];
      expect(data.tourneyId).toHaveLength(6);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO active_sessions'),
        expect.any(Array),
      );
    });

    it('retries on collision', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [1] }) // first collision
        .mockResolvedValueOnce({ rows: [] }) // second unique
        .mockResolvedValueOnce({ rows: [] }) // insert session
        .mockResolvedValueOnce({ rows: [] }); // insert participant

      const req = { method: 'POST' };
      const res = createRes();

      await createTournament(req, res, { userId: validHostUuid, db: mockDb });
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('POST /api/tournament/join', () => {
    it('registers a participant handshake', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'open' }] }) // session check
        .mockResolvedValueOnce({ rows: [] }); // insert participant

      const req = {
        method: 'POST',
        body: { tourneyId: 'abcdef' },
      };
      const res = createRes();

      await joinTournament(req, res, { userId: validPlayerUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'joined' }));
    });

    it('rejects if tournament is closed', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ status: 'completed' }] });

      const req = {
        method: 'POST',
        body: { tourneyId: 'abcdef' },
      };
      const res = createRes();

      await joinTournament(req, res, { userId: validPlayerUuid, db: mockDb });
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('POST /api/stats/tournament-match', () => {
    const defaultIds = {
      tourneyId: 'abcdef',
      winnerId: validWinnerUuid,
      loserId: validLoserUuid,
    };

    it('updates stats only for participants with handshake', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'open', matches_played: 0 }] }) // host check
        .mockResolvedValueOnce({ rows: [{ user_id: validWinnerUuid }] }); // only winner has handshake

      const req = {
        method: 'POST',
        body: defaultIds,
      };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0];
      expect(data.updated.winner).toBe(true);
      expect(data.updated.loser).toBe(false);
    });

    it('enforces match limit', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ status: 'open', matches_played: 32 }] });

      const req = {
        method: 'POST',
        body: defaultIds,
      };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Max match limit') }),
      );
    });

    it('atomicly crowns champion on isFinal', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'open', matches_played: 14 }] }) // host check
        .mockResolvedValueOnce({
          rows: [{ user_id: validWinnerUuid }, { user_id: validLoserUuid }],
        }); // handshake

      const req = {
        method: 'POST',
        body: { ...defaultIds, isFinal: true, championId: validWinnerUuid },
      };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE profiles SET tournament_wins'),
        expect.any(Array),
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'"),
        expect.any(Array),
      );
    });
  });
});
