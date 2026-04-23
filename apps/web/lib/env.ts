// App-internal env access. Keep the surface thin — `process.env.*` reads are
// fine in route handlers and server components, this module is for values that
// need validation, defaults, or cross-file reuse.

export const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ||
  (process.env.NODE_ENV !== 'production'
    ? 'localhost:1999'
    : 'a-los-traques.simon0191.partykit.dev');

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const IS_DEV = process.env.NODE_ENV !== 'production';
