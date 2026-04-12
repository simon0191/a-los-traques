import { beforeEach, describe, expect, it, vi } from 'vitest';
import profileHandler from '../../api/profile.js';

const mockQuery = vi.fn();
const mockClient = {
  query: mockQuery,
  connect: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};
const mockConnect = vi.fn().mockResolvedValue(mockClient);

vi.mock('jose');
vi.mock('pg', () => {
  return {
    default: {
      Pool: class {
        async connect() {
          return mockConnect();
        }
        async query(...args) {
          return mockQuery(...args);
        }
        async end() {
          return Promise.resolve();
        }
      },
      Client: class {
        constructor() {
          this.query = mockQuery;
          this.connect = mockConnect;
          this.end = mockClient.end;
        }
      },
    },
    Pool: class {
      async connect() {
        return mockConnect();
      }
    },
    Client: class {
      constructor() {
        this.connect = mockConnect;
      }
    },
  };
});

describe('Profile API', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'GET',
      headers: { 'x-dev-user-id': 'test-user' },
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.NODE_ENV = 'development';
  });

  it('GET returns profile if found', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ nickname: 'TestUser', wins: 5, losses: 2 }],
    });

    await profileHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ nickname: 'TestUser', wins: 5, losses: 2 });
  });

  it('GET returns 404 if profile not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await profileHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Profile not found' });
  });

  it('POST creates new profile if missing', async () => {
    req.method = 'POST';
    req.body = { nickname: 'Newbie' };

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'test-user', nickname: 'Newbie', wins: 0, losses: 0 }],
    });

    await profileHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ nickname: 'Newbie' }));
  });

  it('POST returns existing profile on conflict', async () => {
    req.method = 'POST';
    req.body = { nickname: 'Newbie' };

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'test-user', nickname: 'OldName', wins: 10, losses: 5 }],
    });

    await profileHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ nickname: 'OldName' }));
  });
});
