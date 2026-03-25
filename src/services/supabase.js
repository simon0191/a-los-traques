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

/**
 * Get the current user's profile
 */
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('nickname, wins, losses')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update user stats (wins or losses)
 */
export async function updateStats(userId, isWin = true) {
  const field = isWin ? 'wins' : 'losses';
  const { data, error } = await supabase.rpc('increment_stat', {
    user_id: userId,
    column_name: field,
  });

  if (error) {
    // Fallback if RPC is not defined yet: manual increment
    const { data: profile } = await supabase
      .from('profiles')
      .select(field)
      .eq('id', userId)
      .single();

    const newVal = (profile?.[field] || 0) + 1;
    const { error: upError } = await supabase
      .from('profiles')
      .update({ [field]: newVal, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (upError) throw upError;
    return { [field]: newVal };
  }

  return data;
}
