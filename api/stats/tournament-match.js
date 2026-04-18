import { withAuth } from '../_lib/handler.js';

/**
 * POST /api/stats/tournament-match
 * Records win/loss for a tournament match. 
 * Secure: Only Host can report, and both players must have joined the session first.
 * Body: { tourneyId: string, winnerId: UUID, loserId: UUID }
 */
export default withAuth(async (req, res, { userId: hostUserId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { tourneyId, winnerId, loserId } = req.body;

  if (!tourneyId || (!winnerId && !loserId)) {
    return res.status(400).json({ error: 'Missing required fields: tourneyId and at least one participant ID' });
  }

  try {
    const tid = tourneyId.toLowerCase();

    // 1. Verify caller is the actual Host of the tournament session
    const hostCheckRes = await db.query(
      'SELECT status FROM active_sessions WHERE id = $1 AND host_user_id = $2',
      [tid, hostUserId]
    );

    if (hostCheckRes.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized: You are not the Host of this tournament' });
    }

    // 2. Verify participants performed the handshake (consent) for this session
    const isUuid = (id) => id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    const checkIds = [winnerId, loserId].filter(isUuid);
    let hasWinnerHandshake = false;
    let hasLoserHandshake = false;

    if (checkIds.length > 0) {
      // Find which of these users actually joined the session
      const handshakeCheckRes = await db.query(
        `SELECT user_id FROM session_participants WHERE session_id = $1`,
        [tid]
      );

      const participatingIds = handshakeCheckRes.rows.map(r => r.user_id);
      hasWinnerHandshake = isUuid(winnerId) && participatingIds.includes(winnerId);
      hasLoserHandshake = isUuid(loserId) && participatingIds.includes(loserId);
    }

    // Update stats using individual non-transactional queries first to isolate errors
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

    return res.status(200).json({
      status: 'success',
      updated: { winner: hasWinnerHandshake, loser: hasLoserHandshake }
    });
  } catch (err) {
    console.error('Error reporting tournament match result:', err);
    return res.status(500).json({ error: 'Database Error', message: err.message });
  }
});
