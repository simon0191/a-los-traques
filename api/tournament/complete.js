import { withAuth } from '../_lib/handler.js';

/**
 * POST /api/tournament/complete
 * "Crowns" the champion and closes the tournament session.
 * Body: { tourneyId: string, championId: UUID }
 */
export default withAuth(async (req, res, { userId: hostUserId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { tourneyId, championId } = req.body;

  if (!tourneyId || !championId) {
    return res.status(400).json({ error: 'Missing required fields: tourneyId, championId' });
  }

  try {
    const tid = tourneyId.toLowerCase();

    // 1. Verify Host ownership and session status
    const sessionRes = await db.query(
      'SELECT status FROM active_sessions WHERE id = $1 AND host_user_id = $2',
      [tid, hostUserId]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized: You are not the Host of this tournament' });
    }

    if (sessionRes.rows[0].status !== 'open') {
      return res.status(400).json({ error: 'Tournament session is already completed' });
    }

    // 2. Verify Champion handshake (consent)
    const isUuid = (id) => id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let hasChampionHandshake = false;

    if (isUuid(championId)) {
      const handshakeRes = await db.query(
        'SELECT user_id FROM session_participants WHERE session_id = $1 AND user_id = $2',
        [tid, championId]
      );
      hasChampionHandshake = handshakeRes.rows.length > 0;
    }

    // Award prestige if the champion is an authenticated participant
    await db.query('BEGIN');

    if (hasChampionHandshake) {
      await db.query(
        'UPDATE profiles SET tournament_wins = tournament_wins + 1, updated_at = now() WHERE id = $1',
        [championId]
      );
    }

    // Close the tournament permanently
    await db.query(
      "UPDATE active_sessions SET status = 'completed' WHERE id = $1",
      [tid]
    );

    await db.query('COMMIT');

    return res.status(200).json({
      status: 'completed',
      prestigeAwarded: hasChampionHandshake
    });

  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error completing tournament session:', err);
    return res.status(500).json({ error: 'Database Error', message: err.message });
  }
});
