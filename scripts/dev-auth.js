/**
 * Fake GoTrue auth server for local multiplayer development.
 *
 * Implements the minimal Supabase Auth REST API so the @supabase/supabase-js
 * client can talk to it transparently. Issues HS256 JWTs verified by the
 * backend via SUPABASE_JWT_SECRET.
 *
 * Pre-seeded test accounts:
 *   p1@test.local / password  (DevP1)
 *   p2@test.local / password  (DevP2)
 */

import { createServer } from 'node:http';
import { jwtVerify, SignJWT } from 'jose';

const PORT = 54321;
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET || 'dev-jwt-secret-at-least-32-characters-long!!';
const SECRET_KEY = new TextEncoder().encode(JWT_SECRET);

// In-memory user store
const users = new Map();
const refreshTokens = new Map(); // refreshToken -> userId

// Pre-seed test users
const SEED_USERS = [
  {
    id: '11111111-0000-0000-0000-000000000001',
    email: 'p1@test.local',
    password: 'password',
    nickname: 'DevP1',
  },
  {
    id: '22222222-0000-0000-0000-000000000002',
    email: 'p2@test.local',
    password: 'password',
    nickname: 'DevP2',
  },
];

for (const u of SEED_USERS) {
  users.set(u.email, { ...u, created_at: new Date().toISOString() });
}

async function signJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: user.id,
    email: user.email,
    aud: 'authenticated',
    role: 'authenticated',
    user_metadata: { nickname: user.nickname },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(`http://localhost:${PORT}/auth/v1`)
    .sign(SECRET_KEY);
}

function userPayload(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.created_at,
    phone: '',
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { nickname: user.nickname },
    identities: [],
    created_at: user.created_at,
    updated_at: new Date().toISOString(),
  };
}

async function sessionResponse(user) {
  const accessToken = await signJwt(user);
  const refreshToken = crypto.randomUUID();
  refreshTokens.set(refreshToken, user.id);

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refreshToken,
    user: userPayload(user),
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // POST /auth/v1/token
  if (req.method === 'POST' && path === '/auth/v1/token') {
    const grantType = url.searchParams.get('grant_type');
    const body = await readBody(req);

    if (grantType === 'password') {
      const user = users.get(body.email);
      if (!user || user.password !== body.password) {
        return json(res, 400, {
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
        });
      }
      return json(res, 200, await sessionResponse(user));
    }

    if (grantType === 'refresh_token') {
      const userId = refreshTokens.get(body.refresh_token);
      if (!userId) {
        return json(res, 400, {
          error: 'invalid_grant',
          error_description: 'Invalid refresh token',
        });
      }
      const user = [...users.values()].find((u) => u.id === userId);
      if (!user) {
        return json(res, 400, { error: 'invalid_grant', error_description: 'User not found' });
      }
      refreshTokens.delete(body.refresh_token);
      return json(res, 200, await sessionResponse(user));
    }

    return json(res, 400, { error: 'unsupported_grant_type' });
  }

  // POST /auth/v1/signup
  if (req.method === 'POST' && path === '/auth/v1/signup') {
    const body = await readBody(req);
    const { email, password } = body;
    const nickname = body.data?.nickname || email?.split('@')[0] || 'Player';

    if (!email || !password) {
      return json(res, 400, {
        error: 'validation_failed',
        error_description: 'Email and password required',
      });
    }
    if (users.has(email)) {
      return json(res, 422, {
        error: 'user_already_exists',
        error_description: 'User already registered',
      });
    }

    const user = {
      id: crypto.randomUUID(),
      email,
      password,
      nickname,
      created_at: new Date().toISOString(),
    };
    users.set(email, user);
    return json(res, 200, await sessionResponse(user));
  }

  // POST /auth/v1/logout
  if (req.method === 'POST' && path === '/auth/v1/logout') {
    res.writeHead(200);
    res.end();
    return;
  }

  // GET /auth/v1/user
  if (req.method === 'GET' && path === '/auth/v1/user') {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return json(res, 401, { error: 'unauthorized', error_description: 'Missing token' });
    }
    try {
      const token = auth.split(' ')[1];
      const { payload } = await jwtVerify(token, SECRET_KEY);
      const user = [...users.values()].find((u) => u.id === payload.sub);
      if (!user) return json(res, 404, { error: 'user_not_found' });
      return json(res, 200, userPayload(user));
    } catch {
      return json(res, 401, { error: 'unauthorized', error_description: 'Invalid token' });
    }
  }

  // Catch-all
  json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`Fake GoTrue auth server on http://localhost:${PORT}`);
  console.log('Test accounts: p1@test.local / p2@test.local (password: password)');
});
