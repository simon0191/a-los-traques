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

const BASE_URL = 'http://localhost:5173';
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

    await ctx1.close();
    await ctx2.close();
  }

  return { logP1, logP2 };
}

test.describe('Multiplayer determinism', () => {
  // Known desync bug with specific fighters — tracked for investigation.
  // Remove .fixme once the underlying determinism issue is resolved.
  test.fixme('both peers reach identical final state', async ({ browser }, testInfo) => {
    const { logP1, logP2 } = await runMatchAndReport(browser, testInfo, {
      p1Opts: { fighter: 'simon', seed: 42 },
      p2Opts: { fighter: 'jeka', seed: 42 },
      testName: 'deterministic fighters',
    });

    expect(logP1.finalStateHash).toBe(logP2.finalStateHash);
    expect(logP1.desyncCount).toBe(0);
    expect(logP2.desyncCount).toBe(0);
    expect(logP1.result?.winnerId || null).toBe(logP2.result?.winnerId || null);
  });

  test('match completes with random fighters', async ({ browser }, testInfo) => {
    const { logP1, logP2 } = await runMatchAndReport(browser, testInfo, {
      p1Opts: {},
      p2Opts: {},
      testName: 'random fighters',
    });

    expect(logP1.finalStateHash).toBe(logP2.finalStateHash);
  });
});
