import { storage } from '@alostraques/api-core/storage';
import { getPool } from '@alostraques/db';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Vercel Cron passes the secret as `Authorization: Bearer <CRON_SECRET>`.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const pool = getPool();
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error('Database connection failed:', (err as Error).message);
    return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
  }

  try {
    const result = await client.query(
      `SELECT id FROM fights
       WHERE has_debug_bundle = TRUE
         AND debug_bundle_expires_at < NOW()`,
    );
    const expiredIds = result.rows.map((r: { id: string }) => r.id);

    if (expiredIds.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    let deleted = 0;
    for (const fightId of expiredIds) {
      try {
        await storage.deleteBundles(fightId);
        await client.query('UPDATE fights SET has_debug_bundle = FALSE WHERE id = $1', [fightId]);
        deleted++;
      } catch (err) {
        console.error(`Failed to cleanup fight ${fightId}:`, (err as Error).message);
      }
    }

    return NextResponse.json({ deleted, total: expiredIds.length });
  } finally {
    if (client) client.release();
  }
}
