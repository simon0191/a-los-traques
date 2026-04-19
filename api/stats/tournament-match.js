import { withAuth } from '../_lib/handler.js';

/**
 * Records win/loss for a tournament match. 
 * Secure: Only Host can report, and both players must have joined the session first.
 * Body: { tourneyId: string, winnerId: UUID, loserId: UUID, isFinal?: boolean, championId?: UUID }
 */
export const reportMatch = async (req, res, { userId: hostUserId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { tourneyId, winnerId, loserId, isFinal, championId } = req.body;

  if (!tourneyId || (!winnerId && !loserId)) {
    return res.status(400).json({ error: 'Missing required fields: tourneyId and at least one participant ID' });
  }

  try {
    const tid = tourneyId.toLowerCase();

    // 1. Verify caller is the actual Host of the tournament session
    const hostCheckRes = await db.query(
      'SELECT status, matches_played, size FROM active_sessions WHERE id = $1 AND host_user_id = $2',
      [tid, hostUserId]
    );

    if (hostCheckRes.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized: You are not the Host of this tournament' });
    }

    const { status, matches_played, size: bracketSize } = hostCheckRes.rows[0];

    if (status !== 'open') {
      return res.status(403).json({ error: 'Tournament session is already completed' });
    }

    // Security Mitigation: Hard limit on match reports per session based on topology
    // A single-elimination bracket of N players has exactly N-1 matches.
    const maxMatches = Math.min(bracketSize - 1, 32); 
    if (matches_played >= maxMatches) {
      return res.status(403).json({ error: 'Max match limit reached for this tournament' });
    }

    // 2. Verify participants performed the handshake (consent) for this session
    const isUuid = (id) => id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    const checkIds = [winnerId, loserId, championId].filter(isUuid);
    let hasWinnerHandshake = false;
    let hasLoserHandshake = false;
    let hasChampionHandshake = false;

    if (checkIds.length > 0) {
      // Find which of these users actually joined the session
      const handshakeCheckRes = await db.query(
        `SELECT user_id FROM session_participants WHERE session_id = $1`,
        [tid]
      );

      const participatingIds = handshakeCheckRes.rows.map(r => r.user_id);
      hasWinnerHandshake = isUuid(winnerId) && participatingIds.includes(winnerId);
      hasLoserHandshake = isUuid(loserId) && participatingIds.includes(loserId);
      hasChampionHandshake = isUuid(championId) && participatingIds.includes(championId);
    }

    // Atomic transaction for all updates
    await db.query('BEGIN');

    // Update match stats
    if (hasWinnerHandshake) {
      await db.query(
        'UPDATE profiles SET wins = wins + 1, updated_at = now() WHERE id = $1',
        [winnerId]
      );
    }

    if (hasLoserHandshake) {
      await db.query(
        'UPDATE profiles SET losses = losses + 1, updated_at = now() WHERE id = $1',
        [loserId]
      );
    }

    // Increment matches played counter
    await db.query(
      'UPDATE active_sessions SET matches_played = matches_played + 1 WHERE id = $1',
      [tid]
    );

    // If this is the final match, crown champion and lock room
    let prestigeAwarded = false;
    if (isFinal) {
      if (hasChampionHandshake) {
        await db.query(
          'UPDATE profiles SET tournament_wins = tournament_wins + 1, updated_at = now() WHERE id = $1',
          [championId]
        );
        prestigeAwarded = true;
      }

      await db.query(
        "UPDATE active_sessions SET status = 'completed' WHERE id = $1",
        [tid]
      );
    }

    await db.query('COMMIT');

    return res.status(200).json({
      status: 'success',
      updated: { winner: hasWinnerHandshake, loser: hasLoserHandshake },
      completed: !!isFinal,
      prestigeAwarded
    });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error reporting tournament match result:', err);
    return res.status(500).json({ error: 'Database Error', message: err.message });
  }
};

export default withAuth(reportMatch);
