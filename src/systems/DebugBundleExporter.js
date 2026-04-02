import { Logger } from './Logger.js';

const log = Logger.create('DebugBundleExporter');

/**
 * Generates debug bundles from FightRecorder, Logger ring buffer,
 * MatchTelemetry, and MatchStateMachine transition history.
 *
 * Extends the E2E bundle format (v1) with a diagnostics section (v2).
 */
export class DebugBundleExporter {
  /**
   * Generate a local debug bundle from the current scene state.
   * @param {object} options
   * @param {import('./FightRecorder.js').FightRecorder} [options.recorder]
   * @param {import('./MatchTelemetry.js').MatchTelemetry} [options.telemetry]
   * @param {import('./MatchStateMachine.js').MatchStateMachine} [options.matchState]
   * @param {string} [options.sessionId]
   * @param {boolean} [options.debugMode]
   * @returns {object} Debug bundle JSON
   */
  static generateBundle({ recorder, telemetry, matchState, sessionId, debugMode = false }) {
    const fightLog = recorder ? window.__FIGHT_LOG : null;

    const bundle = {
      version: 2,
      generatedAt: new Date().toISOString(),
      source: 'debug',
      debugMode,
      sessionId: sessionId ?? null,

      // Existing fields from FightRecorder (compatible with E2E format)
      config: fightLog
        ? {
            p1FighterId: fightLog.fighterId,
            p2FighterId: fightLog.opponentId,
            stageId: fightLog.stageId,
            seed: fightLog.config?.seed ?? null,
            speed: fightLog.config?.speed ?? 1,
            aiDifficulty: fightLog.config?.aiDifficulty ?? null,
          }
        : null,

      confirmedInputs: fightLog?.confirmedInputs ?? [],

      p1: fightLog
        ? {
            playerSlot: fightLog.playerSlot,
            inputs: fightLog.inputs,
            checksums: fightLog.checksums,
            roundEvents: fightLog.roundEvents,
            networkEvents: fightLog.networkEvents,
            finalState: fightLog.finalState,
            finalStateHash: fightLog.finalStateHash,
            totalFrames: fightLog.totalFrames,
            rollbackCount: fightLog.rollbackCount,
            maxRollbackFrames: fightLog.maxRollbackFrames,
            desyncCount: fightLog.desyncCount,
          }
        : null,

      p2: null, // Single-peer debug bundles only have local data

      // NEW: diagnostic data
      diagnostics: {
        telemetry: telemetry?.toJSON() ?? null,
        logBuffer: Logger.getBuffer(),
        matchState: {
          transitions: matchState?.getTransitionHistory() ?? [],
          finalState: matchState?.state ?? null,
        },
        environment: DebugBundleExporter._collectEnvironment(),
      },
    };

    return bundle;
  }

  /**
   * Collect debug bundles from both peers and the server.
   * @param {object} options
   * @param {Function} options.generateLocalBundle - returns local bundle
   * @param {import('./net/NetworkFacade.js').NetworkFacade} options.networkManager
   * @param {number} [options.timeout=3000] - timeout for remote peer response
   * @returns {Promise<object>} Combined bundle
   */
  static async collectAll({ generateLocalBundle, networkManager, timeout = 3000 }) {
    const localBundle = generateLocalBundle();
    const nm = networkManager;

    const combined = {
      version: 2,
      source: 'debug-combined',
      collectedBy: nm.playerSlot === 0 ? 'p1' : 'p2',
      collectedAt: new Date().toISOString(),
      local: localBundle,
      remote: null,
      remoteError: null,
      server: null,
      serverError: null,
    };

    // Collect remote peer data and server diagnostics in parallel
    const [remoteResult, serverResult] = await Promise.allSettled([
      DebugBundleExporter._requestRemoteBundle(nm, timeout),
      DebugBundleExporter._fetchServerDiagnostics(nm),
    ]);

    if (remoteResult.status === 'fulfilled') {
      combined.remote = remoteResult.value;
    } else {
      combined.remoteError = remoteResult.reason?.message ?? 'timeout';
    }

    if (serverResult.status === 'fulfilled') {
      combined.server = serverResult.value;
    } else {
      combined.serverError = serverResult.reason?.message ?? 'fetch_failed';
    }

    return combined;
  }

  /**
   * Copy bundle to clipboard as JSON.
   * @param {object} bundle
   * @returns {Promise<boolean>} true if copied successfully
   */
  static async copyToClipboard(bundle) {
    const json = JSON.stringify(bundle);
    try {
      await navigator.clipboard.writeText(json);
      log.info('Bundle copied to clipboard', { size: json.length });
      return true;
    } catch (err) {
      log.warn('Clipboard copy failed, falling back to download', { err: err.message });
      DebugBundleExporter.downloadBundle(bundle);
      return false;
    }
  }

  /**
   * Download bundle as JSON file.
   * @param {object} bundle
   */
  static downloadBundle(bundle) {
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const roomId = bundle.config?.stageId || bundle.local?.config?.stageId || 'debug';
    a.href = url;
    a.download = `debug-${roomId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log.info('Bundle downloaded', { size: json.length });
  }

  /**
   * Upload a debug bundle to the server. Fire-and-forget.
   * @param {object} options
   * @param {string} options.fightId
   * @param {number} options.slot - Player slot (0 or 1)
   * @param {number} options.round - Round number (0 = match end)
   * @param {object} options.bundle - The debug bundle object
   */
  static uploadBundle({ fightId, slot, round, bundle }) {
    if (!fightId) {
      log.debug('uploadBundle skipped: no fightId');
      return;
    }
    import('../services/api.js')
      .then(({ uploadDebugBundle }) => uploadDebugBundle({ fightId, slot, round, bundle }))
      .then(() => log.info('Bundle uploaded', { fightId, slot, round }))
      .catch((err) => log.warn('Bundle upload failed', { fightId, slot, round, err: err.message }));
  }

  // --- Internal ---

  static _collectEnvironment() {
    const env = {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      platform: typeof navigator !== 'undefined' ? navigator.platform : null,
      connection: null,
    };

    if (typeof navigator !== 'undefined' && navigator.connection) {
      const conn = navigator.connection;
      env.connection = {
        type: conn.effectiveType ?? conn.type ?? null,
        downlink: conn.downlink ?? null,
        rtt: conn.rtt ?? null,
      };
    }

    return env;
  }

  static _requestRemoteBundle(nm, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        nm.signaling.off('debug_response');
        reject(new Error('timeout'));
      }, timeout);

      nm.signaling.on('debug_response', (msg) => {
        clearTimeout(timer);
        nm.signaling.off('debug_response');
        resolve(msg.bundle);
      });

      nm.signaling.send({ type: 'debug_request' });
    });
  }

  static async _fetchServerDiagnostics(nm) {
    try {
      const host = nm._host;
      const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
      const protocol = isLocal ? 'http' : 'https';
      const url = `${protocol}://${host}/parties/main/${nm.roomId}/diagnostics`;

      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) {
        throw new Error(`fetch_failed: ${response.status}`);
      }
      return await response.json();
    } catch (_err) {
      throw new Error('fetch_failed');
    }
  }
}
