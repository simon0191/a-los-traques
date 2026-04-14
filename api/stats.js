import { withAuth } from './_lib/handler.js';

/**
 * POST /api/stats -> Updates user statistics (wins/losses)
 * Body: { isWin: boolean }
 */
export default withAuth(async (req, res, { userId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { isWin } = req.body;
  const col = isWin ? 'wins' : 'losses';

  // Atomic increment with SQL
  const query = `
    UPDATE profiles 
    SET ${col} = ${col} + 1, updated_at = now() 
    WHERE id = $1 
    RETURNING wins, losses;
  `;

  try {
    const result = await db.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error updating stats:', err);
    return res.status(500).json({ error: 'Database Error', message: err.message });
  }
}, { maxRetries: 0 });
