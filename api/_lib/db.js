import pg from 'pg';

const { Pool, Client } = pg;

/**
 * Creates a new Postgres connection pool.
 * Default settings are optimized for Vercel Functions (one connection per process).
 */
export function createPool(connectionString) {
  let url = connectionString || process.env.DATABASE_URL;
  
  // Sanitize localhost to 127.0.0.1 for local dev to avoid Windows IPv6 issues
  if (url?.includes('localhost')) {
    url = url.replace('localhost', '127.0.0.1');
  }

  return new Pool({
    connectionString: url,
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
  let url = connectionString || process.env.DATABASE_URL;
  
  if (url?.includes('localhost')) {
    url = url.replace('localhost', '127.0.0.1');
  }

  return new Client({
    connectionString: url,
    connectionTimeoutMillis: 2000,
  });
}
