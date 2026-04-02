/**
 * Structured, leveled, per-module logger with ring buffer storage.
 * Static singleton — modules get lightweight wrappers via Logger.create('ModuleName').
 *
 * When global level is OFF (default), _log() returns after a single integer
 * comparison. No string formatting, no object allocation.
 */

export const LogLevel = {
  OFF: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
  TRACE: 5,
};

const LEVEL_NAMES = ['OFF', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

export class Logger {
  static _globalLevel = LogLevel.OFF;
  static _moduleOverrides = new Map();
  static _ringBuffer = [];
  static _ringBufferMax = 256;

  /**
   * Create a per-module logger instance.
   * @param {string} module - Module name (e.g. 'TransportManager')
   * @returns {{ error, warn, info, debug, trace }} Logger wrapper
   */
  static create(module) {
    return {
      error: (msg, data) => Logger._log(module, LogLevel.ERROR, msg, data),
      warn: (msg, data) => Logger._log(module, LogLevel.WARN, msg, data),
      info: (msg, data) => Logger._log(module, LogLevel.INFO, msg, data),
      debug: (msg, data) => Logger._log(module, LogLevel.DEBUG, msg, data),
      trace: (msg, data) => Logger._log(module, LogLevel.TRACE, msg, data),
    };
  }

  static setGlobalLevel(level) {
    Logger._globalLevel = level;
  }

  static getGlobalLevel() {
    return Logger._globalLevel;
  }

  static setModuleLevel(module, level) {
    Logger._moduleOverrides.set(module, level);
  }

  static clearModuleLevel(module) {
    Logger._moduleOverrides.delete(module);
  }

  /**
   * Get a copy of the ring buffer contents.
   * @returns {Array<{ts: number, module: string, level: number, levelName: string, msg: string, data: any}>}
   */
  static getBuffer() {
    return Logger._ringBuffer.slice();
  }

  /**
   * Clear ring buffer. Useful for tests.
   */
  static clearBuffer() {
    Logger._ringBuffer.length = 0;
  }

  /**
   * Reset all state (global level, overrides, buffer). For tests.
   */
  static reset() {
    Logger._globalLevel = LogLevel.OFF;
    Logger._moduleOverrides.clear();
    Logger._ringBuffer.length = 0;
  }

  static _log(module, level, msg, data) {
    const threshold = Logger._moduleOverrides.get(module) ?? Logger._globalLevel;
    if (level > threshold) return;

    const entry = {
      ts: Date.now(),
      module,
      level,
      levelName: LEVEL_NAMES[level],
      msg,
      data,
    };

    Logger._ringBuffer.push(entry);
    if (Logger._ringBuffer.length > Logger._ringBufferMax) {
      Logger._ringBuffer.shift();
    }

    const prefix = `[${module}]`;
    if (level <= LogLevel.WARN) {
      console.warn(prefix, msg, data ?? '');
    } else {
      console.log(prefix, msg, data ?? '');
    }
  }
}
