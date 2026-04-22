import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUploadDebugBundle = vi.fn();

vi.mock('../../apps/game-vite/src/services/api.js', () => ({
  uploadDebugBundle: (...args) => mockUploadDebugBundle(...args),
}));

// Mock Logger to avoid side effects
vi.mock('../../apps/game-vite/src/systems/Logger.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    }),
    getBuffer: () => [],
  },
}));

import { DebugBundleExporter } from '../../apps/game-vite/src/systems/DebugBundleExporter.js';

describe('DebugBundleExporter.uploadBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls uploadDebugBundle with correct params', async () => {
    mockUploadDebugBundle.mockResolvedValueOnce({ ok: true });

    DebugBundleExporter.uploadBundle({
      fightId: 'fight-uuid',
      slot: 0,
      round: 1,
      bundle: { version: 2, source: 'debug' },
    });

    // Wait for the async import chain to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(mockUploadDebugBundle).toHaveBeenCalledWith({
      fightId: 'fight-uuid',
      slot: 0,
      round: 1,
      bundle: { version: 2, source: 'debug' },
    });
  });

  it('does not call upload when fightId is missing', async () => {
    DebugBundleExporter.uploadBundle({
      fightId: null,
      slot: 0,
      round: 1,
      bundle: { version: 2 },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockUploadDebugBundle).not.toHaveBeenCalled();
  });

  it('does not throw when upload fails', async () => {
    mockUploadDebugBundle.mockRejectedValueOnce(new Error('Network error'));

    DebugBundleExporter.uploadBundle({
      fightId: 'fight-uuid',
      slot: 0,
      round: 1,
      bundle: { version: 2 },
    });

    // Should not throw — fire-and-forget
    await new Promise((r) => setTimeout(r, 10));

    expect(mockUploadDebugBundle).toHaveBeenCalled();
  });

  it('does not call upload when fightId is undefined', async () => {
    DebugBundleExporter.uploadBundle({
      fightId: undefined,
      slot: 0,
      round: 1,
      bundle: { version: 2 },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockUploadDebugBundle).not.toHaveBeenCalled();
  });
});
