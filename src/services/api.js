import { getSession } from './supabase.js';

const API_BASE = '/api';

/**
 * Generic fetch wrapper for the backend API.
 * Handles JWT attachment and dev bypass.
 */
async function apiFetch(endpoint, options = {}) {
  const session = await getSession();
  const token = session?.access_token;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } 
  // Local development bypass (only if not in production and no token)
  else if (import.meta.env.DEV && !token) {
    headers['X-Dev-User-Id'] = 'local-dev-user';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type');
  let data = {};
  
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (e) {
      console.error('Failed to parse JSON response', e);
    }
  } else {
    // Handle non-JSON or empty responses
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
  return apiFetch('/profile');
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
