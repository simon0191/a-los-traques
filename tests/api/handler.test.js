import { decodeProtectedHeader, jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withAuth } from '../../api/_lib/handler.js';

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockClient = {
  query: (...args) => mockQuery(...args),
  connect: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};
const mockConnect = vi.fn().mockResolvedValue(mockClient);

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  decodeProtectedHeader: vi.fn(),
  createRemoteJWKSet: vi.fn(),
}));

vi.mock('@alostraques/db', () => ({
  createPool: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
  })),
  createClient: vi.fn().mockImplementation(() => {
    mockClient.connect = mockConnect;
    return mockClient;
  }),
  getPool: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
  })),
}));

describe('withAuth middleware', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    process.env.PG_FRESH_CLIENT = '0';
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(handler).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({ userId: 'auth-user' }),
    );
  });

  it('returns 401 on invalid token', async () => {
    req.headers.authorization = 'Bearer invalid-token';
    decodeProtectedHeader.mockReturnValue({ alg: 'HS256' });
    jwtVerify.mockRejectedValue(new Error('Invalid token'));

    const handler = vi.fn();
    const wrapped = withAuth(handler);
    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Unauthorized: Invalid token' }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('retries on database connection failure and succeeds', async () => {
    mockConnect
      .mockRejectedValueOnce(new Error('First fail'))
      .mockRejectedValueOnce(new Error('Second fail'))
      .mockResolvedValue(mockClient);

    req.headers['x-dev-user-id'] = 'dev-user';
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const promise = wrapped(req, res);

    // Fast-forward through retries
    await vi.runAllTimersAsync();
    await promise;

    expect(mockConnect).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenCalled();
  });

  it('fails if database connection fails after all retries', async () => {
    mockConnect.mockRejectedValue(new Error('Connection refused'));
    req.headers['x-dev-user-id'] = 'dev-user';
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const promise = wrapped(req, res);

    // Fast-forward through retries
    await vi.runAllTimersAsync();
    await promise;

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Database connection failed') }),
    );
    expect(mockConnect).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
