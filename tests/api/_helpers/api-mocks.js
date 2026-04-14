import { vi } from 'vitest';

export const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

export const mockClient = {
  query: (...args) => mockQuery(...args),
  connect: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

export const mockConnect = vi.fn().mockResolvedValue(mockClient);

/**
 * Common Jose mock factory
 */
export const joseMock = {
  jwtVerify: vi.fn(),
  decodeProtectedHeader: vi.fn(),
  createRemoteJWKSet: vi.fn(),
};

/**
 * Common DB mock factory
 */
export const dbMock = {
  createPool: vi.fn().mockImplementation(() => ({
    connect: (...args) => mockConnect(...args),
  })),
  createClient: vi.fn().mockImplementation(() => mockClient),
};
