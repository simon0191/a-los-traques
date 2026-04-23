'use client';

import { getAuthHeaders } from './supabase';

export async function adminFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders) throw new Error('Not authenticated');

  const res = await fetch(`/api${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) detail = data.error;
    } catch {
      // ignore — body wasn't JSON
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}
