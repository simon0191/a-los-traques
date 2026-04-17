/**
 * GET /api/public-config
 * Returns public-safe configuration values (like Supabase URL and Anon Key)
 * to avoid hardcoding them in static frontend files.
 */
export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const isLocal = process.env.NODE_ENV !== 'production';

  // Local defaults for dev:mp / dev:all
  const config = {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  };

  // Graceful degradation: If we still don't have config, return nulls
  // Frontend will handle this by showing guest-only mode.
  res.status(200).json({
    supabaseUrl: config.supabaseUrl || null,
    supabaseAnonKey: config.supabaseAnonKey || null,
  });
}
