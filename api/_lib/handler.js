import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import pg from 'pg';

const { Pool } = pg;

// Connection pooling for Vercel Functions
let pool;
let jwks;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

function getJWKS() {
  const projectId = process.env.SUPABASE_PROJECT_ID;
  if (!projectId) return null;
  
  if (!jwks) {
    const url = new URL(`https://${projectId}.supabase.co/auth/v1/.well-known/jwks.json`);
    jwks = createRemoteJWKSet(url);
  }
  return jwks;
}

/**
 * Higher-order function for authenticated handlers.
 * It verifies the Supabase JWT and provides a DB client from the pool.
 */
export function withAuth(handler) {
  return async (req, res) => {
    const isProd = process.env.NODE_ENV === 'production';
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    const projectId = process.env.SUPABASE_PROJECT_ID;
    const authHeader = req.headers.authorization;
    const devUserId = req.headers['x-dev-user-id'];

    let userId;

    // 1. JWT Authentication
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const header = decodeProtectedHeader(token);
        console.log(`[DEBUG] Token algorithm: ${header.alg}`);

        if (header.alg === 'HS256') {
          // Symmetric verification (Legacy)
          if (!jwtSecret) throw new Error('SUPABASE_JWT_SECRET is missing for HS256');
          const secret = new TextEncoder().encode(jwtSecret);
          const { payload } = await jwtVerify(token, secret);
          userId = payload.sub;
        } else {
          // Asymmetric verification (Modern / Signing Keys)
          const remoteJWKS = getJWKS();
          if (!remoteJWKS) throw new Error('SUPABASE_PROJECT_ID is missing for asymmetric verification');
          
          const { payload } = await jwtVerify(token, remoteJWKS, {
            issuer: `https://${projectId}.supabase.co/auth/v1`,
            audience: 'authenticated',
          });
          userId = payload.sub;
        }
      } catch (err) {
        console.error('JWT Verification failed:', err.message);
        return res.status(401).json({ error: 'Unauthorized: Invalid token', message: err.message });
      }
    } 
    // 2. Dev Bypass (non-production only)
    else if (!isProd && devUserId) {
      console.warn('Using dev bypass for userId:', devUserId);
      userId = devUserId;
    } 
    else {
      return res.status(401).json({ error: 'Unauthorized: Missing credentials' });
    }

    // 3. Database Access
    const dbPool = getPool();
    let client;
    try {
      client = await dbPool.connect();
    } catch (err) {
      console.error('Database connection failed:', err.message);
      return res.status(500).json({ error: 'Internal Server Error: Database connection failed' });
    }

    try {
      return await handler(req, res, { userId, db: client });
    } catch (err) {
      console.error('API Handler Error:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: err.message });
    } finally {
      if (client) client.release();
    }
  };
}

/**
 * Higher-order function for admin-only handlers.
 * Wraps withAuth and additionally checks is_admin on the profiles table.
 */
export function withAdmin(handler) {
  return withAuth(async (req, res, { userId, db }) => {
    const result = await db.query('SELECT is_admin FROM profiles WHERE id = $1', [userId]);
    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    return handler(req, res, { userId, db });
  });
}
