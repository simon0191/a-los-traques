/**
 * Hybrid E2E test: local browser (P1) + BrowserStack browser (P2).
 *
 * Simulates a real-world match where two players are in different physical
 * locations. P1 runs on the developer's laptop, P2 runs on BrowserStack.
 * Both hit the deployed staging URL — the WebRTC P2P traffic traverses the
 * real internet between the laptop and BrowserStack's data center.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, test } from '@playwright/test';
import {
  extractFightLog,
  waitForMatchComplete,
  waitForRoomId,
} from '../helpers/browser-helpers.js';
import { generateBundle } from '../helpers/bundle-generator.js';
import { generateReport } from '../helpers/report-generator.js';
import { HYBRID_PRESETS } from './hybrid-config.js';
import {
  REMOTE_MATCH_TIMEOUT,
  REMOTE_PAGE_LOAD_TIMEOUT,
  REMOTE_ROOM_TIMEOUT,
  STAGING_BASE_URL,
  STAGING_PARTY_HOST,
} from './remote-config.js';
import {
  connectRemoteBrowser,
  extractDebugBundle,
  fetchServerDiagnostics,
  markSessionStatus,
  remoteP1Url,
  remoteP2Url,
} from './remote-helpers.js';

const RESULTS_DIR = 'test-results/hybrid';

const presetName = process.env.HYBRID_E2E_PRESET || 'default';

function validateEnv() {
  if (!process.env.BROWSERSTACK_USERNAME || !process.env.BROWSERSTACK_ACCESS_KEY) {
    throw new Error(
      'Missing BrowserStack credentials.\n' +
        'Set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY environment variables.\n' +
        'Get them from: https://www.browserstack.com/accounts/settings',
    );
  }
}

test.describe('Hybrid multiplayer (local + BrowserStack)', () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured first arg
  test(`hybrid match with debug bundles [${presetName}]`, async ({}, testInfo) => {
    validateEnv();

    const preset = HYBRID_PRESETS[presetName];
    if (!preset) {
      throw new Error(
        `Unknown preset "${presetName}". Available: ${Object.keys(HYBRID_PRESETS).join(', ')}`,
      );
    }

    const testName = `hybrid-${presetName}`;
    const startedAt = new Date().toISOString();

    // --- P1: launch locally ---
    const headed = process.env.HYBRID_HEADED === '1';
    console.log(`Launching P1 locally (Chromium, ${headed ? 'headed' : 'headless'})...`);
    const browserP1 = await chromium.launch({ headless: !headed });
    const ctxP1 = await browserP1.newContext({ viewport: { width: 960, height: 540 } });
    const pageP1 = await ctxP1.newPage();

    const p1Console = [];
    const p2Console = [];
    pageP1.on('console', (msg) => p1Console.push(`[${msg.type()}] ${msg.text()}`));

    let browserP2 = null;
    let pageP2 = null;
    let logP1 = null;
    let logP2 = null;
    let usedP1Url = '';
    let usedP2Url = '';
    let roomId = '';

    try {
      // --- P1: create room ---
      usedP1Url = remoteP1Url(STAGING_BASE_URL, STAGING_PARTY_HOST, {
        fighter: 'simon',
        seed: 42,
      });
      console.log(`P1 (local) navigating to: ${usedP1Url}`);
      await pageP1.goto(usedP1Url, { timeout: REMOTE_PAGE_LOAD_TIMEOUT });

      roomId = await waitForRoomId(pageP1, REMOTE_ROOM_TIMEOUT);
      console.log(`Room created: ${roomId}`);

      // --- P2: join room on BrowserStack ---
      console.log(
        `Connecting P2 (${preset.p2.browser} / ${preset.p2.os || 'default'}) on BrowserStack...`,
      );
      browserP2 = await connectRemoteBrowser(preset.p2);
      const ctxP2 = await browserP2.newContext({ viewport: { width: 960, height: 540 } });
      pageP2 = await ctxP2.newPage();
      pageP2.on('console', (msg) => p2Console.push(`[${msg.type()}] ${msg.text()}`));

      usedP2Url = remoteP2Url(STAGING_BASE_URL, roomId, STAGING_PARTY_HOST, {
        fighter: 'jeka',
        seed: 42,
      });
      console.log(`P2 (BrowserStack) navigating to: ${usedP2Url}`);
      await pageP2.goto(usedP2Url, { timeout: REMOTE_PAGE_LOAD_TIMEOUT });

      // --- Wait for match completion ---
      // Poll P2 every 10s to keep CDP WebSocket active (BrowserStack idle timeout).
      // P1 is local so no keep-alive needed, but polling both is harmless.
      console.log('Waiting for match to complete (speed=1, real network)...');
      const pollOpts = { pollInterval: 10_000 };
      await Promise.all([
        waitForMatchComplete(pageP1, REMOTE_MATCH_TIMEOUT, pollOpts),
        waitForMatchComplete(pageP2, REMOTE_MATCH_TIMEOUT, pollOpts),
      ]);
      console.log('Match complete on both sides.');

      // --- Extract fight logs ---
      [logP1, logP2] = await Promise.all([extractFightLog(pageP1), extractFightLog(pageP2)]);

      // --- Extract v2 debug bundles ---
      const [debugP1, debugP2] = await Promise.all([
        extractDebugBundle(pageP1),
        extractDebugBundle(pageP2),
      ]);

      // --- Fetch server diagnostics ---
      const serverDiag = await fetchServerDiagnostics(STAGING_PARTY_HOST, roomId);

      // --- Generate artifacts ---
      fs.mkdirSync(RESULTS_DIR, { recursive: true });

      const report = generateReport(logP1, logP2, testName);
      const bundle = generateBundle(logP1, logP2, { p1: usedP1Url, p2: usedP2Url });

      const completedAt = new Date().toISOString();
      const hybridBundle = {
        ...bundle,
        source: 'hybrid-e2e',
        preset: presetName,
        metadata: {
          startedAt,
          completedAt,
          durationMs: new Date(completedAt) - new Date(startedAt),
          roomId,
          topology: 'hybrid',
          p1: {
            location: 'local',
            browser: 'Chromium (Playwright)',
            fighter: 'simon',
          },
          p2: {
            location: 'browserstack',
            browser:
              `${preset.p2.browser} / ${preset.p2.os || 'device'} ${preset.p2.os_version || ''}`.trim(),
            fighter: 'jeka',
          },
        },
        debugBundles: {
          p1: debugP1,
          p2: debugP2,
        },
        serverDiagnostics: serverDiag,
      };

      fs.writeFileSync(path.join(RESULTS_DIR, `${testName}-report.md`), report);
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${testName}-bundle.json`),
        JSON.stringify(hybridBundle, null, 2),
      );

      // Attach to Playwright results
      await testInfo.attach('report', {
        path: path.join(RESULTS_DIR, `${testName}-report.md`),
        contentType: 'text/markdown',
      });
      await testInfo.attach('bundle', {
        path: path.join(RESULTS_DIR, `${testName}-bundle.json`),
        contentType: 'application/json',
      });

      // --- Determinism analysis (informational, not hard failure) ---
      const p1Checksums = new Map(logP1.checksums.map((c) => [c.frame, c.hash]));
      const p2Checksums = new Map(logP2.checksums.map((c) => [c.frame, c.hash]));
      const sharedFrames = [...p1Checksums.keys()].filter((f) => p2Checksums.has(f));
      const mismatches = sharedFrames.filter((f) => p1Checksums.get(f) !== p2Checksums.get(f));

      if (mismatches.length > 0) {
        console.warn(
          `Checksum mismatches: ${mismatches.length}/${sharedFrames.length} shared frames`,
        );
        console.warn(`First mismatch at frame ${mismatches[0]}`);
      } else {
        console.log(`All ${sharedFrames.length} shared checksums match — deterministic!`);
      }

      console.log(`Desyncs: P1=${logP1.desyncCount}, P2=${logP2.desyncCount}`);
      console.log(`Winner: ${logP1.result?.winnerId || logP2.result?.winnerId || 'unknown'}`);

      // Mark BrowserStack session (P2 only — P1 is local)
      const passed = logP1.matchComplete && logP2.matchComplete;
      await markSessionStatus(pageP2, passed, 'Match completed');
    } finally {
      // Always capture console logs
      if (p1Console.length || p2Console.length) {
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
        const consolePath = path.join(RESULTS_DIR, `${testName}-console.log`);
        fs.writeFileSync(
          consolePath,
          `=== P1 Console [local] (${p1Console.length} messages) ===\n${p1Console.join('\n')}\n\n` +
            `=== P2 Console [BrowserStack] (${p2Console.length} messages) ===\n${p2Console.join('\n')}\n`,
        );
        await testInfo.attach('console-logs', {
          path: consolePath,
          contentType: 'text/plain',
        });
      }

      // Always try to extract partial data on failure
      if (!logP1 || !logP2) {
        try {
          if (!logP1 && pageP1) logP1 = await extractFightLog(pageP1);
          if (!logP2 && pageP2) logP2 = await extractFightLog(pageP2);
          if (logP1 || logP2) {
            fs.mkdirSync(RESULTS_DIR, { recursive: true });
            if (logP1)
              fs.writeFileSync(
                path.join(RESULTS_DIR, `${testName}-partial-p1.json`),
                JSON.stringify(logP1, null, 2),
              );
            if (logP2)
              fs.writeFileSync(
                path.join(RESULTS_DIR, `${testName}-partial-p2.json`),
                JSON.stringify(logP2, null, 2),
              );
          }
        } catch {
          // Best-effort partial extraction
        }
      }

      // Clean up sessions
      try {
        await browserP1.close();
      } catch {
        /* browser may already be closed */
      }
      if (browserP2) {
        try {
          await browserP2.close();
        } catch {
          /* session may already be closed */
        }
      }
    }
  });
});
