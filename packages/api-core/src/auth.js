import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';

let _jwks;

function getJWKS(projectId) {
  if (!projectId) return null;
  if (!_jwks) {
    const url = new URL(`https://${projectId}.supabase.co/auth/v1/.well-known/jwks.json`);
    _jwks = createRemoteJWKSet(url);
  }
  return _jwks;
}

export class AuthError extends Error {
  constructor(message, { status = 401, cause } = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.cause = cause;
  }
}

/**
 * Verify a bearer token and return the Supabase user id. Supports HS256 (shared
 * secret) and asymmetric algorithms via Supabase's JWKS endpoint.
 */
export async function verifyBearerToken(token, { jwtSecret, projectId } = {}) {
  const header = decodeProtectedHeader(token);
  if (header.alg === 'HS256') {
    if (!jwtSecret) throw new AuthError('SUPABASE_JWT_SECRET is missing for HS256');
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    return payload.sub;
  }
  const remoteJWKS = getJWKS(projectId);
  if (!remoteJWKS) {
    throw new AuthError('SUPABASE_PROJECT_ID is missing for asymmetric verification');
  }
  const { payload } = await jwtVerify(token, remoteJWKS, {
    issuer: `https://${projectId}.supabase.co/auth/v1`,
    audience: 'authenticated',
  });
  return payload.sub;
}

/**
 * Resolve a user id from request-scoped inputs (auth header + dev bypass).
 * Framework-agnostic: Vercel, Next.js route handlers, PartyKit endpoints can all
 * call this by plucking the right values out of their own request objects.
 */
export async function resolveUserId({ authHeader, devUserId, isProd, jwtSecret, projectId } = {}) {
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length);
    try {
      return await verifyBearerToken(token, { jwtSecret, projectId });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('Unauthorized: Invalid token', { cause: err });
    }
  }
  if (!isProd && devUserId) {
    return devUserId;
  }
  throw new AuthError('Unauthorized: Missing credentials');
}
