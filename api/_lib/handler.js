import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import { createPool, createClient } from './db.js';

// Connection pooling for Vercel Functions (Production)
let pool;
let jwks;

function getPool() {
  if (!pool) {
    pool = createPool();
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
 * It verifies the Supabase JWT and provides a DB client.
 */
export function withAuth(handler, options = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

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
        if (header.alg === 'HS256') {
          if (!jwtSecret) throw new Error('SUPABASE_JWT_SECRET is missing for HS256');
          const secret = new TextEncoder().encode(jwtSecret);
          const { payload } = await jwtVerify(token, secret);
          userId = payload.sub;
        } else {
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
    else if (!isProd && devUserId) {
      userId = devUserId;
    } 
    else {
      return res.status(401).json({ error: 'Unauthorized: Missing credentials' });
    }

    // 2. Database Access
    // Opt-in fresh client per request (e.g. for Windows local dev)
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
        break; // Success
      } catch (err) {
        attempts++;
        console.error(`Database connection failed (${err.message}). Attempt: ${attempts}`);
        
        if (db && useFreshClient) await db.end().catch(() => {});
        
        if (attempts > maxRetries) {
          return res.status(500).json({ 
            error: 'Internal Server Error: Database connection failed',
            details: err.message 
          });
        }
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }

    try {
      return await handler(req, res, { userId, db });
    } catch (err) {
      console.error('API Handler Error:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: err.message });
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
