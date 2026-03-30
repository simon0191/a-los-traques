import { createClient } from '@supabase/supabase-js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('Supabase');

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authEnabled = !!(supabaseUrl && supabaseAnonKey);

if (!authEnabled) {
  log.warn('Auth disabled: credentials missing');
}

export const supabase = authEnabled ? createClient(supabaseUrl, supabaseAnonKey) : null;

/**
 * Sign up a new user with email, password and nickname
 */
export async function signUp(email, password, nickname) {
  if (!supabase) throw new Error('Auth is disabled');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        nickname: nickname,
      },
    },
  });
  if (error) throw error;
  return data;
}

/**
 * Log in an existing user
 */
export async function logIn(email, password) {
  if (!supabase) throw new Error('Auth is disabled');
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

/**
 * Log out the current user
 */
export async function logOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get the current active session
 */
export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/**
 * Listen for auth state changes
 */
export function onAuthStateChange(callback) {
  if (!supabase) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabase.auth.onAuthStateChange(callback);
}
