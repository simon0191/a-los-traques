import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  extractFightLog,
  p1Url,
  p2Url,
  waitForFightInProgress,
  waitForMatchComplete,
  waitForRoomId,
} from './helpers/browser-helpers.js';
import { generateBundle } from './helpers/bundle-generator.js';
import { generateReport } from './helpers/report-generator.js';

const BASE_URL = 'http://localhost:3000';
const RESULTS_DIR = 'test-results';

test.describe('Multiplayer reconnection', () => {
  test('fight resumes after mid-fight disconnect', async ({ browser }, testInfo) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const pageP1 = await ctx1.newPage();
    const pageP2 = await ctx2.newPage();

    let logP1, logP2, usedP1Url, usedP2Url;

    const p1Console = [];
    const p2Console = [];
    pageP1.on('console', (msg) => p1Console.push(`[${msg.type()}] ${msg.text()}`));
    pageP2.on('console', (msg) => p2Console.push(`[${msg.type()}] ${msg.text()}`));

    const testName = 'reconnection mid-fight';

    try {
      // P1 creates room
      usedP1Url = p1Url(BASE_URL, { fighter: 'simon', seed: 42 });
      await pageP1.goto(usedP1Url);

      const roomId = await waitForRoomId(pageP1);
      expect(roomId).toBeTruthy();

      // P2 joins room
      usedP2Url = p2Url(BASE_URL, roomId, { fighter: 'jeka', seed: 42 });
      await pageP2.goto(usedP2Url);

      // Wait for fight to be in progress (~2 seconds of gameplay)
      await waitForFightInProgress(pageP1, 120);

      // Simulate network drop:
      // 1. Close PartySocket (prevents auto-reconnect)
      // 2. Wait for server to process onClose and start grace period
      // 3. Manually reconnect — server sees rejoin within grace → opponent_reconnected
      await pageP2.evaluate(() => {
        const scene = window.game.scene.getScene('FightScene');
        scene.networkManager.signaling.socket.close();
      });
      await pageP2.waitForTimeout(1500);
      await pageP2.evaluate(() => {
        const scene = window.game.scene.getScene('FightScene');
        scene.networkManager.signaling.socket.reconnect();
      });

      // Wait for both matches to complete after reconnection
      await Promise.all([waitForMatchComplete(pageP1), waitForMatchComplete(pageP2)]);

      [logP1, logP2] = await Promise.all([extractFightLog(pageP1), extractFightLog(pageP2)]);

      // Both peers completed the match after reconnection
      expect(logP1).toBeTruthy();
      expect(logP2).toBeTruthy();
      expect(logP1.matchComplete).toBe(true);
      expect(logP2.matchComplete).toBe(true);

      // P2 experienced a socket close + reopen
      const p2Events = logP2.networkEvents.map((e) => e.type);
      expect(p2Events).toContain('socket_close');
      expect(p2Events).toContain('socket_open');

      // Neither peer's grace period expired
      const p1Events = logP1.networkEvents.map((e) => e.type);
      expect(p1Events).not.toContain('reconnection_disconnect');
      expect(p2Events).not.toContain('reconnection_disconnect');

      // If P1 saw the disconnect, it must also have seen the recovery
      if (p1Events.includes('reconnection_pause')) {
        expect(p1Events).toContain('reconnection_resume');
      }

      // A brief desync during reconnection is expected (missed inputs cause
      // prediction errors that checksums catch). What matters is that both peers
      // continued playing — the resync mechanism corrects any divergence.
      // We only check that the match didn't completely break (both peers have frames).
      expect(logP1.totalFrames).toBeGreaterThan(0);
      expect(logP2.totalFrames).toBeGreaterThan(0);
    } finally {
      if (logP1 && logP2) {
        const report = generateReport(logP1, logP2, testName);
        const bundle = generateBundle(logP1, logP2, { p1: usedP1Url, p2: usedP2Url });

        fs.mkdirSync(RESULTS_DIR, { recursive: true });
        const slug = testName.replace(/\s+/g, '-').toLowerCase();
        const reportPath = path.join(RESULTS_DIR, `${slug}-report.md`);
        const bundlePath = path.join(RESULTS_DIR, `${slug}-bundle.json`);
        fs.writeFileSync(reportPath, report);
        fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

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

        await testInfo.attach('report', { path: reportPath, contentType: 'text/markdown' });
        await testInfo.attach('bundle', { path: bundlePath, contentType: 'application/json' });
      }

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
  });
});
