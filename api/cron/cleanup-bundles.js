import pg from 'pg';
import { storage } from '../_lib/storage.js';

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
    });
  }
  return pool;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Vercel Cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const dbPool = getPool();
  let client;
  try {
    client = await dbPool.connect();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return res.status(500).json({ error: 'Database connection failed' });
  }

  try {
    // Find expired fights with debug bundles
    const result = await client.query(
      `SELECT id FROM fights
       WHERE has_debug_bundle = TRUE
         AND debug_bundle_expires_at < NOW()`,
    );

    const expiredIds = result.rows.map((r) => r.id);

    if (expiredIds.length === 0) {
      return res.status(200).json({ deleted: 0 });
    }

    // Delete storage objects and update DB
    let deleted = 0;
    for (const fightId of expiredIds) {
      try {
        await storage.deleteBundles(fightId);
        await client.query(
          'UPDATE fights SET has_debug_bundle = FALSE WHERE id = $1',
          [fightId],
        );
        deleted++;
      } catch (err) {
        console.error(`Failed to cleanup fight ${fightId}:`, err.message);
      }
    }

    return res.status(200).json({ deleted, total: expiredIds.length });
  } finally {
    if (client) client.release();
  }
}
