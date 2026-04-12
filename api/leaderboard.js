import { withAuth } from './_lib/handler.js';

/**
 * GET /api/leaderboard -> Returns top 10 players ranked by wins,
 * with win rate as tiebreaker. Players with 0 wins are excluded.
 */
export default withAuth(async (req, res, { db }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const query = `
    SELECT
      COALESCE(nickname, 'Anónimo') AS nickname,
      wins,
      losses,
      ROUND(wins::numeric / (wins + losses) * 100) AS win_rate
    FROM profiles
    WHERE wins > 0
    ORDER BY
      wins DESC,
      (wins::numeric / (wins + losses)) DESC
    LIMIT 10;
  `;

  const result = await db.query(query);
  return res.status(200).json(result.rows);
});
