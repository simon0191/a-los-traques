import { withAuth } from '../_lib/handler.js';
import crypto from 'crypto';

/**
 * Creates a new tournament session and returns a unique 6-character ID.
 * Body: { size: number }
 */
export const createTournament = async (req, res, { userId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { size } = req.body || {};
  const bracketSize = parseInt(size, 10) || 8;

  // Retry up to 5 times to find a unique tourneyId
  let tourneyId;
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    tourneyId = crypto.randomBytes(3).toString('hex').toLowerCase();
    
    // Check if ID already exists
    const collisionCheck = await db.query('SELECT 1 FROM active_sessions WHERE id = $1', [tourneyId]);
    if (collisionCheck.rows.length === 0) break;
    
    attempts++;
    if (attempts === maxAttempts) {
      return res.status(500).json({ error: 'Failed to generate unique tournament ID' });
    }
  }

  try {
    // Phase 7: Cleanup orphan sessions from this host
    await db.query(
      "UPDATE active_sessions SET status = 'abandoned' WHERE host_user_id = $1 AND status = 'open'",
      [userId]
    );

    await db.query(
      `INSERT INTO active_sessions (id, host_user_id, status, size)
       VALUES ($1, $2, 'open', $3)`,
      [tourneyId, userId, bracketSize]
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
    // Let the withAuth wrapper handle the 500 response securely (gating detail on NODE_ENV)
    throw err;
  }
};

export default withAuth(createTournament);
