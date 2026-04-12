import { beforeEach, describe, expect, it, vi } from 'vitest';
import statsHandler from '../../api/stats.js';

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

describe('Stats API', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'POST',
      headers: { 'x-dev-user-id': 'test-user' },
      body: { isWin: true },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.NODE_ENV = 'development';
  });

  it('increments wins on isWin: true', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ wins: 1, losses: 0 }],
    });

    await statsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ wins: 1, losses: 0 });
  });

  it('increments losses on isWin: false', async () => {
    req.body.isWin = false;
    mockQuery.mockResolvedValue({
      rows: [{ wins: 0, losses: 1 }],
    });

    await statsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ wins: 0, losses: 1 });
  });

  it('returns 404 if profile missing', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await statsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Profile not found' });
  });
});
