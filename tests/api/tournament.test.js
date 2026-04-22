import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    it('generates a unique 6-char tourneyId and saves bracket size', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // existing open session check
        .mockResolvedValueOnce({ rows: [] }) // collision check
        .mockResolvedValueOnce({ rows: [] }) // cleanup orphan sessions
        .mockResolvedValueOnce({ rows: [{ id: 'test-id' }] }) // insert session
        .mockResolvedValueOnce({ rows: [] }); // insert participant

      const req = { method: 'POST', body: { size: 16 } };
      const res = createRes();

      await createTournament(req, res, { userId: validHostUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(201);
      const data = res.json.mock.calls[0][0];
      expect(data.tourneyId).toHaveLength(6);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO active_sessions'),
        expect.arrayContaining([expect.any(String), validHostUuid, 16]),
      );
    });

    it('updates size of existing open session', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 'old-id', matches_played: 0 }] }) // existing session found
        .mockResolvedValueOnce({ rows: [] }); // update size

      const req = { method: 'POST', body: { size: 16, allowUpdate: true } };
      const res = createRes();

      await createTournament(req, res, { userId: validHostUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ tourneyId: 'old-id' });
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE active_sessions SET size = $1'),
        [16, 'old-id'],
      );
    });

    it('fails to update size if matches have already started', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'old-id', matches_played: 1 }] }); // matches started

      const req = { method: 'POST', body: { size: 16, allowUpdate: true } };
      const res = createRes();

      await createTournament(req, res, { userId: validHostUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Cannot update tournament size'),
        }),
      );
    });

    it('retries on collision', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // existing check
        .mockResolvedValueOnce({ rows: [1] }) // first collision
        .mockResolvedValueOnce({ rows: [] }) // second unique
        .mockResolvedValueOnce({ rows: [] }) // cleanup
        .mockResolvedValueOnce({ rows: [] }) // insert session
        .mockResolvedValueOnce({ rows: [] }); // insert participant

      const req = { method: 'POST', body: { size: 8 } };
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
      roundIndex: 0,
      matchIndex: 0,
    };

    it('updates stats and increments matches_played on first report (handshake check)', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'open', matches_played: 0, size: 8 }] }) // host check
        .mockResolvedValueOnce({ rows: [{ user_id: defaultIds.winnerId }] }) // only winner has handshake
        .mockResolvedValueOnce({ rows: [{ success: true }] }) // BEGIN
        .mockResolvedValueOnce({ rows: [1] }); // INSERT INTO tournament_matches RETURNING 1

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

      // Verify profile update for winner
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE profiles SET wins = wins + 1'),
        [defaultIds.winnerId],
      );
      // Loser should not be updated as they didn't handshake (Regression Test #3)
      expect(mockDb.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE profiles SET losses = losses + 1'),
        expect.any(Array),
      );
      // Verify counter increment
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE active_sessions SET matches_played = matches_played + 1'),
        [defaultIds.tourneyId.toLowerCase()],
      );
    });

    it('ignores duplicate reports for the same match (Ledger Pattern)', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'open', matches_played: 1, size: 8 }] }) // host check
        .mockResolvedValueOnce({ rows: [{ user_id: validWinnerUuid }] }) // handshake
        .mockResolvedValueOnce({ rows: [{ success: true }] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }); // INSERT INTO tournament_matches returns nothing (collision)

      const req = {
        method: 'POST',
        body: defaultIds,
      };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0];
      expect(data.status).toBe('ignored');
      expect(data.reason).toContain('already reported');

      // Verify ROLLBACK was called
      expect(mockDb.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('atomically crowns champion on isFinal (Regression Test #1)', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'open', matches_played: 6, size: 8 }] }) // host check
        .mockResolvedValueOnce({
          rows: [{ user_id: validWinnerUuid }, { user_id: validLoserUuid }],
        }) // handshakes
        .mockResolvedValueOnce({ rows: [{ success: true }] }) // BEGIN
        .mockResolvedValueOnce({ rows: [1] }); // Ledger insert

      const req = {
        method: 'POST',
        body: { ...defaultIds, isFinal: true, championId: validWinnerUuid },
      };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(200);
      // Verify crowning
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE profiles SET tournament_wins = tournament_wins + 1'),
        [validWinnerUuid],
      );
      // Verify room locking
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE active_sessions SET status = 'completed'"),
        [defaultIds.tourneyId.toLowerCase()],
      );
    });

    it('increments matches_played even if no profiles are updated (no handshakes) (Regression Test #2)', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ status: 'open', matches_played: 0, size: 8 }] }) // host check
        .mockResolvedValueOnce({ rows: [] }) // no handshakes (e.g. AI match)
        .mockResolvedValueOnce({ rows: [{ success: true }] }) // BEGIN
        .mockResolvedValueOnce({ rows: [1] }); // Ledger insert

      const req = { method: 'POST', body: defaultIds };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });

      expect(res.status).toHaveBeenCalledWith(200);
      // Verify session counter is still incremented
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE active_sessions SET matches_played = matches_played + 1'),
        [defaultIds.tourneyId.toLowerCase()],
      );
      // Verify profiles are NOT updated
      expect(mockDb.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE profiles SET wins'),
        expect.any(Array),
      );
    });

    it('idempotently handles match limit based on bracket size', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [{ status: 'open', matches_played: 7, size: 8 }],
      });

      const req = {
        method: 'POST',
        body: defaultIds,
      };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ignored',
          reason: expect.stringContaining('limit reached'),
        }),
      );
    });

    it('returns 400 when winnerId === loserId', async () => {
      const req = {
        method: 'POST',
        body: { ...defaultIds, winnerId: validWinnerUuid, loserId: validWinnerUuid },
      };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when indices are missing', async () => {
      const req = {
        method: 'POST',
        body: { tourneyId: 'abc', winnerId: validWinnerUuid },
      };
      const res = createRes();

      await reportMatch(req, res, { userId: validHostUuid, db: mockDb });
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
