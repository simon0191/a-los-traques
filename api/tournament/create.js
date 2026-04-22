import { withAuth } from '../_lib/handler.js';
import crypto from 'crypto';

export const SQL_CHECK_EXISTING_SESSION = 'SELECT id, matches_played FROM active_sessions WHERE host_user_id = $1 AND status = $2';
export const SQL_UPDATE_SESSION_SIZE = 'UPDATE active_sessions SET size = $1 WHERE id = $2';
export const SQL_CHECK_COLLISION = 'SELECT 1 FROM active_sessions WHERE id = $1';
export const SQL_ABANDON_ORPHAN_SESSIONS = "UPDATE active_sessions SET status = 'abandoned' WHERE host_user_id = $1 AND status = 'open'";
export const SQL_INSERT_SESSION = `
  INSERT INTO active_sessions (id, host_user_id, status, size)
  VALUES ($1, $2, 'open', $3)
`;
export const SQL_JOIN_HOST = `
  INSERT INTO session_participants (session_id, user_id)
  VALUES ($1, $2)
  ON CONFLICT DO NOTHING
`;

/**
 * Creates a new tournament session and returns a unique 6-character ID.
 * Body: { size: number }
 */
export const createTournament = async (req, res, { userId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { size, allowUpdate } = req.body || {};
  const bracketSize = parseInt(size, 10) || 8;

  // Retry up to 5 times to find a unique tourneyId
  let tourneyId;
  let attempts = 0;
  const maxAttempts = 5;

  try {
    // Phase 7: Update existing open session if requested
    if (allowUpdate) {
      const existingRes = await db.query(SQL_CHECK_EXISTING_SESSION, [userId, 'open']);

      if (existingRes.rows.length > 0) {
        tourneyId = existingRes.rows[0].id;
        const matchesPlayed = parseInt(existingRes.rows[0].matches_played, 10) || 0;

        if (matchesPlayed > 0) {
          return res.status(403).json({ error: 'Cannot update tournament size after matches have started' });
        }

        await db.query(SQL_UPDATE_SESSION_SIZE, [bracketSize, tourneyId]);
        return res.status(200).json({ tourneyId });
      }
    }

    while (attempts < maxAttempts) {
      tourneyId = crypto.randomBytes(3).toString('hex').toLowerCase();

      // Check if ID already exists
      const collisionCheck = await db.query(SQL_CHECK_COLLISION, [tourneyId]);
      if (collisionCheck.rows.length === 0) break;

      attempts++;
      if (attempts === maxAttempts) {
        return res.status(500).json({ error: 'Failed to generate unique tournament ID' });
      }
    }

    // Cleanup orphan sessions (precautionary)
    await db.query(SQL_ABANDON_ORPHAN_SESSIONS, [userId]);

    await db.query(SQL_INSERT_SESSION, [tourneyId, userId, bracketSize]);

    // Also automatically join the host to their own tournament
    await db.query(SQL_JOIN_HOST, [tourneyId, userId]);

    return res.status(201).json({ tourneyId });
  } catch (err) {
    console.error('Error creating tournament session:', err);
    // Let the withAuth wrapper handle the 500 response securely (gating detail on NODE_ENV)
    throw err;
  }
};

export default withAuth(createTournament);
