import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import pg from 'pg';

// Handle both default and named imports for testing compatibility
const Pool = pg.Pool || pg.default?.Pool;
const Client = pg.Client || pg.default?.Client;

// Connection pooling for Vercel Functions (Production)
let pool;
let jwks;

function getPool() {
  if (!pool) {
    let connectionString = process.env.DATABASE_URL;
    // Force 127.0.0.1 on local dev to avoid ECONNRESET/IPv6 issues on Windows
    if (connectionString?.includes('localhost')) {
      connectionString = connectionString.replace('localhost', '127.0.0.1');
    }

    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
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
    const isLocal = !isProd;
    let db;
    let retries = 3;

    while (retries > 0) {
      try {
        if (isLocal) {
          // For local development, always use a fresh client to avoid ECONNRESET on Windows
          let connectionString = process.env.DATABASE_URL;
          if (connectionString?.includes('localhost')) {
            connectionString = connectionString.replace('localhost', '127.0.0.1');
          }
          db = new Client({ connectionString, connectionTimeoutMillis: 5000 });
          await db.connect();
        } else {
          const dbPool = getPool();
          db = await dbPool.connect();
        }
        break; // Success
      } catch (err) {
        retries--;
        console.error(`Database connection failed (${err.message}). Retries: ${retries}`);
        if (db && isLocal) await db.end().catch(() => {});
        
        if (retries === 0) {
          return res.status(500).json({ 
            error: 'Internal Server Error: Database connection failed',
            details: err.message 
          });
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    try {
      return await handler(req, res, { userId, db });
    } catch (err) {
      console.error('API Handler Error:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: err.message });
    } finally {
      if (db) {
        if (isLocal) await db.end().catch(() => {});
        else db.release();
      }
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
