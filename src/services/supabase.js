import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authEnabled = !!(supabaseUrl && supabaseAnonKey);

if (!authEnabled) {
  console.warn('Supabase credentials missing. Auth features will be disabled.');
}

// Create client with dummy strings if missing to avoid resolving to current host
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
);

/**
 * Sign up a new user with email, password and nickname
 */
export async function signUp(email, password, nickname) {
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
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get the current active session
 */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/**
 * Listen for auth state changes
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}
