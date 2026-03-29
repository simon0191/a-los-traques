import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withAuth } from '../../api/_lib/handler.js';
import { jwtVerify, decodeProtectedHeader } from 'jose';
import pg from 'pg';

const mockQuery = vi.fn();
const mockConnect = vi.fn(async () => ({
  query: mockQuery,
  release: vi.fn(),
}));

vi.mock('jose');
vi.mock('pg', () => {
  class Pool {
    constructor() {
      this.connect = mockConnect;
    }
  }
  return {
    default: { Pool },
    Pool,
  };
});

describe('withAuth middleware', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    process.env.DATABASE_URL = 'postgres://localhost:5432/test';
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_JWT_SECRET = 'test-secret';
    process.env.SUPABASE_PROJECT_ID = 'test-project';
  });

  it('fails if no authorization header or dev bypass', async () => {
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Missing credentials' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows dev bypass in non-production', async () => {
    req.headers['x-dev-user-id'] = 'dev-user';
    const handler = vi.fn().mockResolvedValue({ success: true });
    const wrapped = withAuth(handler);
    await wrapped(req, res);

    expect(handler).toHaveBeenCalledWith(req, res, expect.objectContaining({ userId: 'dev-user' }));
  });

  it('disallows dev bypass in production', async () => {
    process.env.NODE_ENV = 'production';
    req.headers['x-dev-user-id'] = 'dev-user';
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('verifies valid HS256 JWT token', async () => {
    req.headers.authorization = 'Bearer valid-token';
    decodeProtectedHeader.mockReturnValue({ alg: 'HS256' });
    jwtVerify.mockResolvedValue({ payload: { sub: 'auth-user' } });

    const handler = vi.fn().mockResolvedValue({ success: true });
    const wrapped = withAuth(handler);
    await wrapped(req, res);

    expect(jwtVerify).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(req, res, expect.objectContaining({ userId: 'auth-user' }));
  });

  it('returns 401 on invalid token', async () => {
    req.headers.authorization = 'Bearer invalid-token';
    decodeProtectedHeader.mockReturnValue({ alg: 'HS256' });
    jwtVerify.mockRejectedValue(new Error('Invalid token'));

    const handler = vi.fn();
    const wrapped = withAuth(handler);
    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized: Invalid token' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails if DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    req.headers['x-dev-user-id'] = 'dev-user';
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Database configuration missing') }));
  });
});
