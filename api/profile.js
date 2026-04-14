import { withAuth } from './_lib/handler.js';

/**
 * GET /api/profile -> Returns profile data
 * POST /api/profile -> Upserts profile (for new users)
 */
export default withAuth(async (req, res, { userId, db }) => {
  if (req.method === 'GET') {
    const result = await db.query(
      'SELECT nickname, wins, losses FROM profiles WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    return res.status(200).json(result.rows[0]);
  } 
  
  if (req.method === 'POST') {
    const { nickname } = req.body;
    
    // UPSERT: Create if not exists, do nothing on conflict (to avoid resetting stats)
    // We only set the nickname if it's provided and it's a new row.
    const query = `
      INSERT INTO profiles (id, nickname) 
      VALUES ($1, $2) 
      ON CONFLICT (id) DO NOTHING
      RETURNING *;
    `;
    
    const result = await db.query(query, [userId, nickname || `user-${userId.slice(0, 4)}`]);
    
    // If nothing was inserted (row existed), fetch the current profile
    if (result.rows.length === 0) {
      const current = await db.query('SELECT * FROM profiles WHERE id = $1', [userId]);
      return res.status(200).json(current.rows[0]);
    }
    
    return res.status(201).json(result.rows[0]);
  }
  
  return res.status(405).json({ error: 'Method Not Allowed' });
}, { maxRetries: 0 });
