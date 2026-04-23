import { createClient } from '@supabase/supabase-js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('Supabase');

// Auth credentials are injected by createGame({ env }) so the package stays
// framework-agnostic. `supabase` is null until initAuthEnv() is called;
// consumers must handle that (they already do for guest mode).
let _supabase = null;
let _authEnabled = false;

export function initAuthEnv({ url, anonKey } = {}) {
  _authEnabled = !!(url && anonKey);
  if (_authEnabled) {
    _supabase = createClient(url, anonKey);
  } else {
    _supabase = null;
    log.warn('Auth disabled: credentials missing');
  }
}

export function isAuthEnabled() {
  return _authEnabled;
}

// Keep a `supabase` getter so existing scene imports work unchanged.
export const supabase = new Proxy(
  {},
  {
    get(_t, prop) {
      if (!_supabase) return undefined;
      const val = _supabase[prop];
      return typeof val === 'function' ? val.bind(_supabase) : val;
    },
  },
);

function requireClient() {
  if (!_supabase) throw new Error('Auth is disabled');
  return _supabase;
}

/**
 * Sign up a new user with email, password and nickname
 */
export async function signUp(email, password, nickname) {
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    options: { data: { nickname } },
  });
  if (error) throw error;
  return data;
}

/**
 * Log in using Google OAuth. We explicitly set `redirectTo` to the current
 * URL so Supabase brings the user back to `/play` (and keeps any query
 * params like `?room=`). Without this, Supabase falls back to the project's
 * Site URL — which for us is the marketing `/` page, where no Supabase
 * client is initialised to consume the `#access_token=…` hash. The user
 * would then land on / "logged in" as far as Google is concerned but the
 * session would never reach localStorage, so the game (on /play) still
 * sees them as anonymous.
 */
export async function logInWithGoogle() {
  const redirectTo = typeof window !== 'undefined' ? window.location.href : undefined;
  const { data, error } = await requireClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
  return data;
}

/**
 * Log in an existing user
 */
export async function logIn(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * Log out the current user
 */
export async function logOut() {
  if (!_supabase) return;
  const { error } = await _supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get the current active session
 */
export async function getSession() {
  if (!_supabase) return null;
  const { data, error } = await _supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/**
 * Listen for auth state changes
 */
export function onAuthStateChange(callback) {
  if (!_supabase) return { data: { subscription: { unsubscribe: () => {} } } };
  return _supabase.auth.onAuthStateChange(callback);
}
