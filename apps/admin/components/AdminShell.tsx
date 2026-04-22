'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/fetchAdmin';
import { getSupabaseClient, isAuthConfigured } from '@/lib/supabase';
import { LoginForm } from './LoginForm';

type ShellState = 'checking' | 'authed' | 'needs-login' | 'not-admin';

/**
 * Gatekeeper: tries a low-cost admin call (HEAD-like GET) against
 * `/api/admin/fights` to verify both that a session exists and that the
 * caller is actually an admin. Non-admins get routed back to the login
 * screen with a human-readable error.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ShellState>('checking');
  const [error, setError] = useState('');

  const verify = async () => {
    setError('');
    setState('checking');
    const authed = await hasSession();
    if (!authed) {
      setState('needs-login');
      return;
    }
    try {
      await adminFetch('/admin/fights?page=1&limit=1');
      setState('authed');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('not-admin');
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once bootstrap
  useEffect(() => {
    verify();
  }, []);

  if (state === 'checking') {
    return <div className="loading">Cargando…</div>;
  }

  if (state === 'needs-login' || state === 'not-admin') {
    return <LoginForm onAuthenticated={verify} initialError={error} />;
  }

  return (
    <>
      <nav>
        <h1>A Los Traques Admin</h1>
        <a href="/" className="active">
          Peleas
        </a>
        <button
          type="button"
          onClick={async () => {
            const sb = getSupabaseClient();
            if (sb) await sb.auth.signOut();
            setState('needs-login');
          }}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            color: '#aaa',
            border: '1px solid #333',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Salir
        </button>
      </nav>
      {children}
    </>
  );
}

async function hasSession(): Promise<boolean> {
  if (!isAuthConfigured()) {
    // Dev bypass: adminFetch will send X-Dev-User-Id, and the DB seed marks
    // the dev user as admin, so treat that as "has session".
    return true;
  }
  const sb = getSupabaseClient();
  if (!sb) return false;
  const {
    data: { session },
  } = await sb.auth.getSession();
  return Boolean(session);
}
