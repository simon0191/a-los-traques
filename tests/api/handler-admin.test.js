import { decodeProtectedHeader, jwtVerify } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withAdmin } from '../../api/_lib/handler.js';

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockClient = {
  query: (...args) => mockQuery(...args),
  connect: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  decodeProtectedHeader: vi.fn(),
  createRemoteJWKSet: vi.fn(),
}));

vi.mock('../../api/_lib/db.js', () => ({
  createPool: vi.fn().mockImplementation(() => ({
    connect: () => Promise.resolve(mockClient),
  })),
  createClient: vi.fn().mockImplementation(() => mockClient),
}));

function setupDevAuth(req) {
  req.headers['x-dev-user-id'] = 'admin-user-id';
  process.env.NODE_ENV = 'development';
}

describe('withAdmin middleware', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { headers: {} };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    process.env.DATABASE_URL = 'postgres://localhost:5432/test';
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_JWT_SECRET = 'test-secret';
    process.env.SUPABASE_PROJECT_ID = 'test-project';
  });

  it('allows request when user is admin', async () => {
    setupDevAuth(req);
    mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: true }] });

    const handler = vi.fn().mockResolvedValue({ success: true });
    const wrapped = withAdmin(handler);
    await wrapped(req, res);

    expect(handler).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({ userId: 'admin-user-id' }),
    );
  });

  it('returns 403 when user is_admin is false', async () => {
    setupDevAuth(req);
    mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: false }] });

    const handler = vi.fn();
    const wrapped = withAdmin(handler);
    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Admin') }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 403 when user has no profile row', async () => {
    setupDevAuth(req);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const handler = vi.fn();
    const wrapped = withAdmin(handler);
    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('still performs JWT verification (inherits from withAuth)', async () => {
    req.headers.authorization = 'Bearer valid-token';
    decodeProtectedHeader.mockReturnValue({ alg: 'HS256' });
    jwtVerify.mockResolvedValue({ payload: { sub: 'jwt-user' } });
    mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: true }] });

    const handler = vi.fn().mockResolvedValue({ success: true });
    const wrapped = withAdmin(handler);
    await wrapped(req, res);

    expect(jwtVerify).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(req, res, expect.objectContaining({ userId: 'jwt-user' }));
  });

  it('returns 401 without auth credentials', async () => {
    const handler = vi.fn();
    const wrapped = withAdmin(handler);
    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('dev bypass works but still checks is_admin', async () => {
    setupDevAuth(req);
    // First call returns admin check
    mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: false }] });

    const handler = vi.fn();
    const wrapped = withAdmin(handler);
    await wrapped(req, res);

    // Auth passed (dev bypass) but admin check failed
    expect(res.status).toHaveBeenCalledWith(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
