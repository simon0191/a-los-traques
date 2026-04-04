import { withAdmin } from '../_lib/handler.js';
import { storage } from '../_lib/storage.js';

export default withAdmin(async (req, res, { userId, db }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const hasDebug = req.query?.hasDebug === 'true';

  const whereClause = hasDebug ? 'WHERE f.has_debug_bundle = TRUE' : '';

  // Get total count
  const countResult = await db.query(
    `SELECT COUNT(*) FROM fights f ${whereClause}`,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get paginated fights with player nicknames
  const result = await db.query(
    `SELECT
      f.id,
      f.room_id,
      f.p1_user_id,
      f.p2_user_id,
      f.p1_fighter,
      f.p2_fighter,
      f.stage_id,
      f.started_at,
      f.ended_at,
      f.winner_slot,
      f.rounds_p1,
      f.rounds_p2,
      f.has_debug_bundle,
      f.debug_bundle_expires_at,
      p1.nickname AS p1_nickname,
      p2.nickname AS p2_nickname
    FROM fights f
    LEFT JOIN profiles p1 ON f.p1_user_id = p1.id
    LEFT JOIN profiles p2 ON f.p2_user_id = p2.id
    ${whereClause}
    ORDER BY f.started_at DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  // For fights with debug bundles, list available bundle files
  const fights = await Promise.all(
    result.rows.map(async (fight) => {
      let bundles = [];
      if (fight.has_debug_bundle) {
        bundles = await storage.listBundles(fight.id);
      }
      return {
        ...fight,
        bundles,
      };
    }),
  );

  return res.status(200).json({
    fights,
    total,
    page,
    limit,
  });
});
