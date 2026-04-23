'use client';

import { useState } from 'react';
import { getSupabaseClient, isAuthConfigured } from '@/lib/supabase';

type LoginFormProps = {
  onAuthenticated: () => void;
  initialError?: string;
};

export function LoginForm({ onAuthenticated, initialError = '' }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isAuthConfigured()) {
      setError('Supabase no está configurado');
      return;
    }
    const sb = getSupabaseClient();
    if (!sb) {
      setError('Cliente Supabase no disponible');
      return;
    }

    setSubmitting(true);
    const { error: authError } = await sb.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    onAuthenticated();
  };

  return (
    <div className="login-form">
      <h2>Admin — Iniciar Sesión</h2>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
