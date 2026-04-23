import { storage } from '@alostraques/api-core/storage';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/auth/middleware';

export const GET = withAdmin(async (req: NextRequest, { db }) => {
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get('page') || '', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(params.get('limit') || '', 10) || 20));
  const offset = (page - 1) * limit;
  const hasDebug = params.get('hasDebug') === 'true';

  const whereClause = hasDebug ? 'WHERE f.has_debug_bundle = TRUE' : '';

  const countResult = await db.query(`SELECT COUNT(*) FROM fights f ${whereClause}`);
  const total = Number.parseInt(countResult.rows[0].count, 10);

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

  const fights = await Promise.all(
    result.rows.map(async (fight: { id: string; has_debug_bundle: boolean }) => {
      let bundles: unknown[] = [];
      if (fight.has_debug_bundle) {
        bundles = await storage.listBundles(fight.id);
      }
      return { ...fight, bundles };
    }),
  );

  return NextResponse.json({ fights, total, page, limit });
});
