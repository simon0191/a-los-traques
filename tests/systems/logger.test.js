import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, LogLevel } from '../../apps/game-vite/src/systems/Logger.js';

describe('Logger', () => {
  beforeEach(() => {
    Logger.reset();
    vi.restoreAllMocks();
  });

  it('returns empty buffer when level is OFF', () => {
    const log = Logger.create('Test');
    log.debug('should not appear');
    expect(Logger.getBuffer()).toHaveLength(0);
  });

  it('logs when global level is sufficient', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setGlobalLevel(LogLevel.DEBUG);
    const log = Logger.create('Test');
    log.debug('hello', { key: 'value' });

    const buf = Logger.getBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0].module).toBe('Test');
    expect(buf[0].level).toBe(LogLevel.DEBUG);
    expect(buf[0].msg).toBe('hello');
    expect(buf[0].data).toEqual({ key: 'value' });
    expect(buf[0].levelName).toBe('DEBUG');
    expect(buf[0].ts).toBeGreaterThan(0);
  });

  it('filters by level threshold', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Logger.setGlobalLevel(LogLevel.WARN);
    const log = Logger.create('Test');

    log.trace('no');
    log.debug('no');
    log.info('no');
    log.warn('yes');
    log.error('yes');

    expect(Logger.getBuffer()).toHaveLength(2);
    expect(Logger.getBuffer()[0].levelName).toBe('WARN');
    expect(Logger.getBuffer()[1].levelName).toBe('ERROR');
  });

  it('supports per-module level overrides', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setGlobalLevel(LogLevel.OFF);
    Logger.setModuleLevel('Verbose', LogLevel.TRACE);

    const verbose = Logger.create('Verbose');
    const quiet = Logger.create('Quiet');

    verbose.trace('should appear');
    quiet.trace('should not');

    expect(Logger.getBuffer()).toHaveLength(1);
    expect(Logger.getBuffer()[0].module).toBe('Verbose');
  });

  it('caps ring buffer at max size', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setGlobalLevel(LogLevel.DEBUG);
    const log = Logger.create('Test');

    for (let i = 0; i < 300; i++) {
      log.debug(`msg-${i}`);
    }

    const buf = Logger.getBuffer();
    expect(buf).toHaveLength(256);
    expect(buf[0].msg).toBe('msg-44'); // first 44 were evicted
    expect(buf[255].msg).toBe('msg-299');
  });

  it('routes WARN/ERROR to console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setGlobalLevel(LogLevel.DEBUG);
    const log = Logger.create('Test');

    log.warn('warning');
    log.error('error');
    log.debug('debug');

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('clearModuleLevel removes override', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setModuleLevel('Mod', LogLevel.DEBUG);
    Logger.clearModuleLevel('Mod');

    const log = Logger.create('Mod');
    log.debug('should not appear');
    expect(Logger.getBuffer()).toHaveLength(0);
  });

  it('clearBuffer empties the ring buffer', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setGlobalLevel(LogLevel.DEBUG);
    Logger.create('Test').debug('msg');
    expect(Logger.getBuffer()).toHaveLength(1);

    Logger.clearBuffer();
    expect(Logger.getBuffer()).toHaveLength(0);
  });
});
