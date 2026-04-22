'use client';

import { useState } from 'react';
import { AdminShell } from './AdminShell';
import { Sidebar } from './Sidebar';

/**
 * Layout wrapper for every page under `(authed)/`. AdminShell runs the auth
 * gate (login form / not-admin message); once it passes, we render the
 * sidebar + main content area.
 */
export function AuthedShell({ children }: { children: React.ReactNode }) {
  // Bump this to force AdminShell to re-run its auth check after sign out —
  // the gate doesn't watch Supabase events itself, so the sidebar hands it a
  // "please recheck" signal via key change.
  const [signOutNonce, setSignOutNonce] = useState(0);

  return (
    <AdminShell key={signOutNonce}>
      <div className="admin-shell">
        <Sidebar onSignOut={() => setSignOutNonce((n) => n + 1)} />
        <main className="admin-main">{children}</main>
      </div>
    </AdminShell>
  );
}
