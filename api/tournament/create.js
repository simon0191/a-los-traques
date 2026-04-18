import { withAuth } from '../_lib/handler.js';
import crypto from 'crypto';

/**
 * POST /api/tournament/create
 * Creates a new tournament session and returns a unique 6-character ID.
 */
export default withAuth(async (req, res, { userId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Generate a unique 6-character alphanumeric ID
  const tourneyId = crypto.randomBytes(3).toString('hex').toLowerCase();

  try {
    await db.query(
      `INSERT INTO active_sessions (id, host_user_id, status)
       VALUES ($1, $2, 'open')`,
      [tourneyId, userId]
    );

    // Also automatically join the host to their own tournament
    await db.query(
      `INSERT INTO session_participants (session_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [tourneyId, userId]
    );

    return res.status(201).json({ tourneyId });
  } catch (err) {
    console.error('Error creating tournament session:', err);
    return res.status(500).json({ error: 'Database Error', message: err.message });
  }
});
