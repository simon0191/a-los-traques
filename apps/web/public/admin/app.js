import htm from 'https://esm.sh/htm@3.1.1';
import { h, render } from 'https://esm.sh/preact@10.25.4';
import { useEffect, useState } from 'https://esm.sh/preact@10.25.4/hooks';
import { FightsPage } from './pages/fights.js';

const html = htm.bind(h);

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

let supabaseClient = null;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.101.1');

  // Read Supabase config from the main app's env (injected by Vite)
  // In production, these are baked into the main bundle. For admin, we read from meta tag or fallback.
  const url =
    document.querySelector('meta[name="supabase-url"]')?.content || window.__SUPABASE_URL || '';
  const key =
    document.querySelector('meta[name="supabase-anon-key"]')?.content ||
    window.__SUPABASE_ANON_KEY ||
    '';

  if (!url || !key) {
    // Dev mode: no auth needed, use dev bypass
    return null;
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}

async function getAuthHeaders() {
  const sb = await getSupabase();
  if (!sb) {
    // Dev mode bypass
    return { 'X-Dev-User-Id': '00000000-0000-0000-0000-000000000000' };
  }
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

async function apiFetch(endpoint, options = {}) {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders) throw new Error('Not authenticated');

  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json();
  }
  return response;
}

// ---------------------------------------------------------------------------
// App Component
// ---------------------------------------------------------------------------

function App() {
  const [authed, setAuthed] = useState(null); // null = loading, true/false
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const sb = await getSupabase();
    if (!sb) {
      // Dev mode: skip auth
      setAuthed(true);
      return;
    }
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (session) {
      // Verify admin access
      try {
        await apiFetch('/admin/fights?page=1&limit=1');
        setAuthed(true);
      } catch {
        setError('No tienes acceso de administrador');
        setAuthed(false);
      }
    } else {
      setAuthed(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    const sb = await getSupabase();
    if (!sb) return;

    const { error: authError } = await sb.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      return;
    }
    await checkAuth();
  }

  if (authed === null) {
    return html`<div class="loading">Cargando...</div>`;
  }

  if (!authed) {
    return html`
      <div class="login-form">
        <h2>Admin - Iniciar Sesión</h2>
        <form onSubmit=${handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value=${email}
            onInput=${(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value=${password}
            onInput=${(e) => setPassword(e.target.value)}
          />
          <button type="submit">Entrar</button>
          ${error && html`<div class="error">${error}</div>`}
        </form>
      </div>
    `;
  }

  return html`
    <nav>
      <h1>A Los Traques Admin</h1>
      <a href="/admin/" class="active">Peleas</a>
    </nav>
    <${FightsPage} apiFetch=${apiFetch} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));
