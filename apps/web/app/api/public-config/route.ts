import { NextResponse } from 'next/server';

/**
 * GET /api/public-config
 * Returns public-safe configuration values (Supabase URL + anon key). The game
 * falls back to guest mode when either value is null.
 */
export function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
  });
}
