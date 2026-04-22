// Vercel Function adapter that composes @alostraques/api-core's framework-agnostic
// auth with a connection lease from @alostraques/db. The Next.js app (Phase 2) will
// grow its own adapter at apps/web/lib/auth/middleware.ts using the same core.

import { AuthError, resolveUserId } from '@alostraques/api-core';
import { createClient, getPool } from '@alostraques/db';

/**
 * Higher-order function for authenticated handlers.
 * Verifies the Supabase JWT (or dev bypass) and supplies a DB client.
 */
export function withAuth(handler, options = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  return async (req, res) => {
    const isProd = process.env.NODE_ENV === 'production';
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    const projectId = process.env.SUPABASE_PROJECT_ID;

    let userId;
    try {
      userId = await resolveUserId({
        authHeader: req.headers.authorization,
        devUserId: req.headers['x-dev-user-id'],
        isProd,
        jwtSecret,
        projectId,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        console.error('JWT Verification failed:', err.cause?.message ?? err.message);
        const body = { error: err.message };
        if (err.cause?.message) body.message = err.cause.message;
        return res.status(err.status).json(body);
      }
      throw err;
    }

    // Opt-in fresh client per request (e.g. Windows local dev).
    const useFreshClient = process.env.PG_FRESH_CLIENT === '1';

    let db;
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        if (useFreshClient) {
          db = createClient();
          await db.connect();
        } else {
          const dbPool = getPool();
          db = await dbPool.connect();
        }
        break;
      } catch (err) {
        attempts++;
        console.error(`Database connection failed (${err.message}). Attempt: ${attempts}`);

        if (db && useFreshClient) await db.end().catch(() => {});

        if (attempts > maxRetries) {
          const response = { error: 'Internal Server Error: Database connection failed' };
          if (process.env.NODE_ENV !== 'production') {
            response.details = err.message;
          }
          return res.status(500).json(response);
        }
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }

    try {
      return await handler(req, res, { userId, db });
    } catch (err) {
      console.error('API Handler Error:', err);
      const response = { error: 'Internal Server Error' };
      if (process.env.NODE_ENV !== 'production') {
        response.message = err.message;
      }
      return res.status(500).json(response);
    } finally {
      if (db) {
        if (useFreshClient) await db.end().catch(() => {});
        else db.release();
      }
    }
  };
}

/**
 * Higher-order function for admin-only handlers.
 */
export function withAdmin(handler, options = {}) {
  return withAuth(async (req, res, { userId, db }) => {
    const result = await db.query('SELECT is_admin FROM profiles WHERE id = $1', [userId]);
    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    return handler(req, res, { userId, db });
  }, options);
}
