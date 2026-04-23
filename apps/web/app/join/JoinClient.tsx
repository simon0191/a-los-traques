'use client';

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { useSearchParams } from 'next/navigation';
import PartySocket from 'partysocket';
import { useEffect, useRef, useState } from 'react';
import styles from './join.module.css';

type AuthTab = 'login' | 'signup' | 'guest';

type PartyKitLobbyState = {
  tourneyId?: string;
  slots?: Array<{ id?: string; name?: string; handshake?: boolean } | null>;
};

type JoinResult = { state: 'joined'; name: string } | { state: 'idle' };

function partyHostFor(isLocal: boolean) {
  return isLocal ? 'localhost:1999' : 'a-los-traques.simon0191.partykit.dev';
}

export function JoinClient() {
  const params = useSearchParams();
  const roomId = params.get('room')?.toLowerCase() ?? null;
  const tourneyIdParam = params.get('tourney') ?? null;

  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [status, setStatus] = useState<{ msg: string; variant: 'error' | 'success' | '' }>({
    msg: '',
    variant: '',
  });
  const [loading, setLoading] = useState(false);
  const [authClient, setAuthClient] = useState<SupabaseClient | null>(null);
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roomLabel, setRoomLabel] = useState('Conectando…');
  const [result, setResult] = useState<JoinResult>({ state: 'idle' });

  const socketRef = useRef<PartySocket | null>(null);
  const lobbyRef = useRef<PartyKitLobbyState | null>(null);
  const handshakeRef = useRef<{ tid: string | null; done: boolean }>({ tid: null, done: false });

  // biome-ignore lint/correctness/useExhaustiveDependencies: boot-once; roomId is URL-derived and intentionally not a dep
  useEffect(() => {
    let disposed = false;

    (async () => {
      if (!roomId) {
        setRoomLabel('ERROR: NO SE ENCONTRÓ SALA');
        return;
      }

      // Public config tells us whether Supabase auth is wired up.
      let cfg: { supabaseUrl: string | null; supabaseAnonKey: string | null } = {
        supabaseUrl: null,
        supabaseAnonKey: null,
      };
      try {
        const resp = await fetch('/api/public-config');
        if (resp.ok) cfg = await resp.json();
      } catch (err) {
        console.warn('[join] public-config fetch failed, guest-only', err);
      }
      if (disposed) return;

      if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
        const client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        setAuthClient(client);
        setAuthConfigured(true);
        const { data } = await client.auth.getSession();
        if (!disposed && data.session) setSession(data.session);
      } else {
        setAuthConfigured(false);
        setActiveTab('guest');
      }

      // Open the signaling socket for the room. Messages carry lobbyState; we
      // only need it to know the active tournament id for the handshake.
      const isLocal =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const socket = new PartySocket({ host: partyHostFor(isLocal), room: roomId });
      socketRef.current = socket;
      setRoomLabel(`SALA: ${roomId}`);

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'request_lobby_update' }));
      });
      socket.addEventListener('message', (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'lobby_update' || msg.type === 'init_tournament') {
            lobbyRef.current = msg.lobbyState ?? null;
          }
        } catch {
          // ignore malformed payload
        }
      });
    })().catch((err) => console.error('[join] init error', err));

    return () => {
      disposed = true;
      socketRef.current?.close();
    };
  }, []);

  const showStatus = (msg: string, variant: 'error' | 'success' | '' = '') => {
    setStatus({ msg, variant });
  };

  const performHandshake = async (): Promise<boolean> => {
    const tid = lobbyRef.current?.tourneyId ?? tourneyIdParam;
    if (!tid || !authClient) return false;
    if (handshakeRef.current.tid !== tid) {
      handshakeRef.current = { tid, done: false };
    }
    if (handshakeRef.current.done) return true;

    const { data } = await authClient.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;

    try {
      const resp = await fetch('/api/tournament/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tourneyId: tid }),
      });
      if (!resp.ok) return false;
      handshakeRef.current.done = true;
      const mySlot = lobbyRef.current?.slots?.find((s) => s?.id === data.session?.user.id);
      if (mySlot && !mySlot.handshake) {
        socketRef.current?.send(
          JSON.stringify({
            type: 'lobby_action',
            action: 'VERIFY_HANDSHAKE',
            payload: { id: data.session?.user.id },
          }),
        );
      }
      return true;
    } catch (err) {
      console.warn('[join] handshake error', err);
      return false;
    }
  };

  const sendJoin = async (name: string, id: string | null, type: 'guest' | 'human') => {
    if (!lobbyRef.current) {
      showStatus('Error: esperando al servidor…', 'error');
      return;
    }
    setLoading(true);
    showStatus('Uniéndose…', 'success');
    let handshakeOk = false;
    if (type === 'human' && id && authClient) {
      try {
        handshakeOk = await performHandshake();
      } catch (err) {
        console.warn('[join] handshake failed, continuing unverified', err);
      }
    }
    socketRef.current?.send(
      JSON.stringify({
        type: 'lobby_action',
        action: 'JOIN_SLOT',
        payload: { name, id, type, handshake: handshakeOk },
      }),
    );
    setResult({ state: 'joined', name });
  };

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPass, setSignupPass] = useState('');
  const [signupNick, setSignupNick] = useState('');
  const [guestName, setGuestName] = useState('');

  const handleLogin = async () => {
    if (!authClient) return;
    if (!loginEmail || !loginPass) return showStatus('Completa los campos', 'error');
    setLoading(true);
    const { data, error } = await authClient.auth.signInWithPassword({
      email: loginEmail,
      password: loginPass,
    });
    if (error) {
      setLoading(false);
      return showStatus(error.message, 'error');
    }
    const nick =
      (data.user.user_metadata as { nickname?: string } | null)?.nickname ??
      loginEmail.split('@')[0];
    setSession(data.session);
    await sendJoin(nick, data.user.id, 'human');
  };

  const handleSignup = async () => {
    if (!authClient) return;
    if (!signupNick || !signupEmail || !signupPass)
      return showStatus('Completa los campos', 'error');
    setLoading(true);
    const { error } = await authClient.auth.signUp({
      email: signupEmail,
      password: signupPass,
      options: { data: { nickname: signupNick } },
    });
    setLoading(false);
    if (error) return showStatus(error.message, 'error');
    showStatus('¡Cuenta creada! Revisa tu email para verificar.', 'success');
  };

  const handleGoogle = () => {
    if (!authClient) return;
    authClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    });
  };

  const handleGuest = () => {
    const trimmed = guestName.trim();
    if (!trimmed) return showStatus('Escribe un nombre', 'error');
    sendJoin(trimmed, null, 'guest').catch((err) => console.error(err));
  };

  const handleLogout = async () => {
    if (authClient) await authClient.auth.signOut();
    window.location.reload();
  };

  const sessionNick =
    session && session.user
      ? (session.user.user_metadata as { nickname?: string } | null)?.nickname ||
        session.user.email?.split('@')[0] ||
        'JUGADOR'
      : null;

  if (result.state === 'joined') {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <h1 style={{ color: '#44cc88' }}>¡LISTO!</h1>
          <div className={styles.roomTag}>{result.name.toUpperCase()} REGISTRADO</div>
          <p className={styles.doneMessage}>
            Ya estás en el torneo. Puedes cerrar esta pestaña o registrar a alguien más.
          </p>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleLogout}
          >
            REGISTRAR A OTRA PERSONA
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1>TORNEO LOCAL</h1>
        <div className={styles.roomTag}>{roomLabel}</div>

        {sessionNick ? (
          <div className={styles.activeSession}>
            <div className={styles.label}>Sesión activa como</div>
            <div className={styles.name}>{sessionNick.toUpperCase()}</div>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() =>
                sendJoin(sessionNick, session?.user.id ?? null, 'human').catch((err) =>
                  console.error(err),
                )
              }
              disabled={loading}
            >
              UNIRSE AL TORNEO
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.logoutBtn}`}
              onClick={handleLogout}
              disabled={loading}
            >
              CERRAR SESIÓN
            </button>
          </div>
        ) : (
          <>
            <div className={styles.tabs}>
              {authConfigured !== false && (
                <>
                  <button
                    type="button"
                    className={`${styles.tab} ${activeTab === 'login' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('login')}
                  >
                    ENTRAR
                  </button>
                  <button
                    type="button"
                    className={`${styles.tab} ${activeTab === 'signup' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('signup')}
                  >
                    REGISTRO
                  </button>
                </>
              )}
              <button
                type="button"
                className={`${styles.tab} ${activeTab === 'guest' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('guest')}
              >
                INVITADO
              </button>
            </div>

            <div
              className={`${styles.statusMsg} ${
                status.variant === 'error' ? styles.error : ''
              } ${status.variant === 'success' ? styles.success : ''}`}
            >
              {status.msg}
            </div>

            {activeTab === 'login' && authConfigured && (
              <>
                <div className={styles.formGroup}>
                  <input
                    type="email"
                    placeholder="Email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <input
                    type="password"
                    placeholder="Contraseña"
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={handleLogin}
                  disabled={loading}
                >
                  ENTRAR Y UNIRSE
                </button>
                <hr className={styles.divider} />
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGoogle}`}
                  onClick={handleGoogle}
                  disabled={loading}
                >
                  CONTINUAR CON GOOGLE
                </button>
              </>
            )}

            {activeTab === 'signup' && authConfigured && (
              <>
                <div className={styles.formGroup}>
                  <input
                    type="text"
                    placeholder="Apodo"
                    value={signupNick}
                    onChange={(e) => setSignupNick(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <input
                    type="email"
                    placeholder="Email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <input
                    type="password"
                    placeholder="Contraseña"
                    value={signupPass}
                    onChange={(e) => setSignupPass(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSignup}`}
                  onClick={handleSignup}
                  disabled={loading}
                >
                  CREAR CUENTA
                </button>
              </>
            )}

            {activeTab === 'guest' && (
              <>
                <div className={styles.formGroup}>
                  <input
                    type="text"
                    placeholder="Tu Apodo (Ej: Simon)"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={handleGuest}
                  disabled={loading}
                >
                  UNIRSE COMO INVITADO
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
