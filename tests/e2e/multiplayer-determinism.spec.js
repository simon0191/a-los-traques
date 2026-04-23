import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  extractFightLog,
  p1Url,
  p2Url,
  waitForMatchComplete,
  waitForRoomId,
} from './helpers/browser-helpers.js';
import { generateBundle } from './helpers/bundle-generator.js';
import { generateReport } from './helpers/report-generator.js';

const BASE_URL = 'http://localhost:3000';
const RESULTS_DIR = 'test-results';

/**
 * Run a multiplayer match and extract logs from both browsers.
 * Generates report + bundle artifacts regardless of pass/fail.
 */
async function runMatchAndReport(browser, testInfo, { p1Opts, p2Opts, testName }) {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const pageP1 = await ctx1.newPage();
  const pageP2 = await ctx2.newPage();

  let logP1, logP2, usedP1Url, usedP2Url;

  // Capture console logs from both browsers
  const p1Console = [];
  const p2Console = [];
  pageP1.on('console', (msg) => p1Console.push(`[${msg.type()}] ${msg.text()}`));
  pageP2.on('console', (msg) => p2Console.push(`[${msg.type()}] ${msg.text()}`));

  try {
    // P1 creates a room
    usedP1Url = p1Url(BASE_URL, p1Opts);
    await pageP1.goto(usedP1Url);

    const roomId = await waitForRoomId(pageP1);
    expect(roomId).toBeTruthy();

    // P2 joins the room
    usedP2Url = p2Url(BASE_URL, roomId, p2Opts);
    await pageP2.goto(usedP2Url);

    // Wait for both matches to complete
    await Promise.all([waitForMatchComplete(pageP1), waitForMatchComplete(pageP2)]);

    // Extract fight logs from both browsers
    [logP1, logP2] = await Promise.all([extractFightLog(pageP1), extractFightLog(pageP2)]);

    expect(logP1).toBeTruthy();
    expect(logP2).toBeTruthy();
    expect(logP1.matchComplete).toBe(true);
    expect(logP2.matchComplete).toBe(true);
  } finally {
    // Generate report + bundle even if assertions above failed
    if (logP1 && logP2) {
      const report = generateReport(logP1, logP2, testName);
      const bundle = generateBundle(logP1, logP2, { p1: usedP1Url, p2: usedP2Url });

      // Write to disk
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
      const slug = testName.replace(/\s+/g, '-').toLowerCase();
      const reportPath = path.join(RESULTS_DIR, `${slug}-report.md`);
      const bundlePath = path.join(RESULTS_DIR, `${slug}-bundle.json`);
      fs.writeFileSync(reportPath, report);
      fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

      // Append to CI summary file (aggregates all tests)
      const hashMatch = logP1.finalStateHash === logP2.finalStateHash;
      const icon =
        hashMatch && logP1.desyncCount === 0 && logP2.desyncCount === 0
          ? ':white_check_mark:'
          : ':x:';
      const summaryLine =
        `${icon} **${testName}** — ${logP1.fighterId} vs ${logP2.fighterId} | ` +
        `hash: ${hashMatch ? 'match' : 'MISMATCH'} | ` +
        `desyncs: ${logP1.desyncCount + logP2.desyncCount} | ` +
        `winner: ${logP1.result?.winnerId || logP2.result?.winnerId || '?'}`;
      const summaryPath = path.join(RESULTS_DIR, 'ci-summary.md');
      fs.appendFileSync(summaryPath, `${summaryLine}\n`);

      // Attach to Playwright test results
      await testInfo.attach('report', { path: reportPath, contentType: 'text/markdown' });
      await testInfo.attach('bundle', { path: bundlePath, contentType: 'application/json' });
    }

    // Attach console logs (always, even without fight logs)
    if (p1Console.length > 0 || p2Console.length > 0) {
      const consolePath = path.join(
        RESULTS_DIR,
        `${testName.replace(/\s+/g, '-').toLowerCase()}-console.log`,
      );
      const consoleContent =
        `=== P1 Console (${p1Console.length} messages) ===\n${p1Console.join('\n')}\n\n` +
        `=== P2 Console (${p2Console.length} messages) ===\n${p2Console.join('\n')}\n`;
      fs.writeFileSync(consolePath, consoleContent);
      await testInfo.attach('console-logs', { path: consolePath, contentType: 'text/plain' });
    }

    await ctx1.close();
    await ctx2.close();
  }

  return { logP1, logP2 };
}

test.describe('Multiplayer determinism', () => {
  test('both peers reach identical final state (seeded)', async ({ browser }, testInfo) => {
    const { logP1, logP2 } = await runMatchAndReport(browser, testInfo, {
      p1Opts: { fighter: 'simon', seed: 42 },
      p2Opts: { fighter: 'jeka', seed: 42 },
      testName: 'deterministic fighters',
    });

    const p1Checksums = new Map(logP1.checksums.map((c) => [c.frame, c.hash]));
    const p2Checksums = new Map(logP2.checksums.map((c) => [c.frame, c.hash]));
    const sharedFrames = [...p1Checksums.keys()].filter((f) => p2Checksums.has(f));

    expect(sharedFrames.length).toBeGreaterThan(0);
    for (const frame of sharedFrames) {
      expect(p1Checksums.get(frame), `checksum mismatch at frame ${frame}`).toBe(
        p2Checksums.get(frame),
      );
    }
    expect(logP1.desyncCount).toBe(0);
    expect(logP2.desyncCount).toBe(0);
  });

  // Note: match with random fighters often fails desync/determinism check (flaky)
  // Tracked for investigation: certain fighter combinations (e.g. alv vs peks) diverge.
  test('match completes with random fighters', async ({ browser }, testInfo) => {
    const { logP1, logP2 } = await runMatchAndReport(browser, testInfo, {
      p1Opts: {},
      p2Opts: {},
      testName: 'random fighters',
    });

    // Compare determinism via checksums — these compare confirmed-frame snapshots
    // that both peers computed independently. Final state hash can differ because
    // peers capture it at different frame counts (P2 receives match-over event
    // a few frames after P1 fires it).
    const p1Checksums = new Map(logP1.checksums.map((c) => [c.frame, c.hash]));
    const p2Checksums = new Map(logP2.checksums.map((c) => [c.frame, c.hash]));
    const sharedFrames = [...p1Checksums.keys()].filter((f) => p2Checksums.has(f));

    expect(sharedFrames.length).toBeGreaterThan(0);
    for (const frame of sharedFrames) {
      expect(p1Checksums.get(frame), `checksum mismatch at frame ${frame}`).toBe(
        p2Checksums.get(frame),
      );
    }
  });
});
