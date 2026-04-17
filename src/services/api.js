import { Logger } from '../systems/Logger.js';
import { authEnabled, getSession } from './supabase.js';

const log = Logger.create('API');

const API_BASE = '/api';

/**
 * Generic fetch wrapper for the backend API.
 * Handles JWT attachment and dev bypass.
 */
async function apiFetch(endpoint, options = {}) {
  // If no auth credentials, return mock data for specific endpoints to allow local testing
  if (!authEnabled) {
    if (endpoint === '/profile') {
      return { id: 'dev-p1', nickname: 'Anfitrión Local' };
    }
    if (endpoint === '/leaderboard') {
      return [];
    }
    // For other endpoints, we just let them fail or return empty
  }

  const session = await getSession();
  const token = session?.access_token;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (import.meta.env.DEV && !token) {
    headers['X-Dev-User-Id'] = '00000000-0000-0000-0000-000000000000';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type');
  let data = {};

  if (contentType?.includes('application/json')) {
    try {
      data = await response.json();
    } catch (e) {
      log.warn('JSON parse error', { endpoint, err: e.message });
    }
  } else {
    const text = await response.text();
    if (text) {
      data = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || `API Request Failed: ${response.status}`);
  }

  return data;
}

/**
 * Get the current user's profile
 */
export async function getProfile() {
  // Only retry idempotent reads once
  return withRetry(() => apiFetch('/profile'), { maxRetries: 1, label: 'getProfile' });
}

/**
 * Get the global leaderboard (top 10 players by wins)
 */
export async function getLeaderboard() {
  return apiFetch('/leaderboard');
}

/**
 * Sync/Create the user profile (called on login)
 */
export async function syncProfile(nickname) {
  return apiFetch('/profile', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
}

/**
 * Update user stats (wins or losses)
 */
export async function updateStats(isWin = true) {
  return apiFetch('/stats', {
    method: 'POST',
    body: JSON.stringify({ isWin }),
  });
}

/**
 * Retry a function with exponential backoff.
 */
async function withRetry(fn, { maxRetries = 1, label = 'request' } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = 1000 * 2 ** attempt;
      log.warn(`${label} failed, retrying`, { attempt, delay, err: err.message });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Create a fight record (called by P1 at match start)
 */
export async function createFight({ fightId, roomId, p1Fighter, p2Fighter, stageId }) {
  const body = JSON.stringify({ fightId, roomId, p1Fighter, p2Fighter, stageId });
  return apiFetch('/fights', { method: 'POST', body });
}

/**
 * Update a fight record (P2 registration or match result)
 */
export async function updateFight(fields) {
  const body = JSON.stringify(fields);
  return apiFetch('/fights', { method: 'PATCH', body });
}

/**
 * Upload a debug bundle for a fight round.
 */
export async function uploadDebugBundle({ fightId, slot, round, bundle }) {
  const body = JSON.stringify({ fightId, slot, round, bundle });
  return apiFetch('/debug-bundles', { method: 'POST', body });
}
