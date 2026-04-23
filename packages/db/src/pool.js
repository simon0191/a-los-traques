import pg from 'pg';

const { Pool, Client } = pg;

// Memoize pool on globalThis so HMR / repeated imports don't open duplicate connections.
const POOL_KEY = Symbol.for('@alostraques/db.pool');

function normalizeUrl(connectionString) {
  let url = connectionString || process.env.DATABASE_URL;
  // Sanitize localhost to 127.0.0.1 for local dev to avoid Windows IPv6 issues.
  if (url?.includes('localhost')) {
    url = url.replace('localhost', '127.0.0.1');
  }
  return url;
}

/**
 * Creates a new Postgres connection pool.
 * Default settings are optimized for serverless functions (one connection per process).
 */
export function createPool(connectionString) {
  return new Pool({
    connectionString: normalizeUrl(connectionString),
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    // Vercel + Supabase recommendation is max 1 to avoid blowing connection limits
    max: 1,
    connectionTimeoutMillis: 2000,
  });
}

/**
 * Creates a new single-use Postgres client.
 * Used for local development on Windows where Pooling can cause ECONNRESET.
 */
export function createClient(connectionString) {
  return new Client({
    connectionString: normalizeUrl(connectionString),
    connectionTimeoutMillis: 2000,
  });
}

/**
 * Returns a memoized process-wide Pool. Use this in request handlers so every
 * invocation shares one connection pool. Survives Next.js HMR via globalThis.
 */
export function getPool(connectionString) {
  const g = /** @type {any} */ (globalThis);
  if (!g[POOL_KEY]) {
    g[POOL_KEY] = createPool(connectionString);
  }
  return g[POOL_KEY];
}
