'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Browser-side Supabase client. Returns null in environments where public
 * Supabase env vars are absent (dev without fake auth, for example), in which
 * case the admin app falls back to the dev-bypass header for API calls.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key);
  return _client;
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Resolve the auth headers to send with admin API calls. In production this is
 * the Supabase Bearer token. In local dev without Supabase, it's the dev
 * bypass UUID that the admin seed (`packages/db/seed-dev.sql`) marks as
 * `is_admin = true`.
 */
export async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const client = getSupabaseClient();
  if (!client) {
    return { 'X-Dev-User-Id': '11111111-0000-0000-0000-000000000001' };
  }
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}
