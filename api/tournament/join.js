import { withAuth } from '../_lib/handler.js';

/**
 * Player "handshake": explicit consent to join a tournament session.
 * Body: { tourneyId: string }
 */
export const joinTournament = async (req, res, { userId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { tourneyId } = req.body;

  if (!tourneyId) {
    return res.status(400).json({ error: 'Missing tourneyId' });
  }

  try {
    // 1. Verify the tournament session exists and is open
    const sessionRes = await db.query(
      'SELECT status FROM active_sessions WHERE id = $1',
      [tourneyId.toLowerCase()]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (sessionRes.rows[0].status !== 'open') {
      return res.status(403).json({ error: 'Tournament is already completed' });
    }

    // 2. Insert participant record (handshake)
    await db.query(
      `INSERT INTO session_participants (session_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [tourneyId.toLowerCase(), userId]
    );

    return res.status(200).json({ status: 'joined', tourneyId: tourneyId.toLowerCase() });
  } catch (err) {
    console.error('Error joining tournament session:', err);
    throw err;
  }
};

export default withAuth(joinTournament);
