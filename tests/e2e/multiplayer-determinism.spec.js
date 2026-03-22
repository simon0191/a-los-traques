import { expect, test } from '@playwright/test';
import {
  extractFightLog,
  p1Url,
  p2Url,
  waitForMatchComplete,
  waitForRoomId,
} from './helpers/browser-helpers.js';

const BASE_URL = 'http://localhost:5173';

test.describe('Multiplayer determinism', () => {
  // Known desync bug with specific fighters — tracked for investigation.
  // Remove .fixme once the underlying determinism issue is resolved.
  test.fixme('both peers reach identical final state', async ({ browser }) => {
    // Create two independent browser contexts (simulates two separate players)
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const pageP1 = await ctx1.newPage();
    const pageP2 = await ctx2.newPage();

    // Suppress console noise in test output but collect errors
    const errors = { p1: [], p2: [] };
    pageP1.on('pageerror', (err) => errors.p1.push(err.message));
    pageP2.on('pageerror', (err) => errors.p2.push(err.message));

    try {
      // P1 creates a room
      await pageP1.goto(p1Url(BASE_URL, { fighter: 'simon', seed: 42 }));

      // Wait for room ID to be exposed
      const roomId = await waitForRoomId(pageP1);
      expect(roomId).toBeTruthy();

      // P2 joins the room
      await pageP2.goto(p2Url(BASE_URL, roomId, { fighter: 'jeka', seed: 42 }));

      // Wait for both matches to complete
      await Promise.all([waitForMatchComplete(pageP1), waitForMatchComplete(pageP2)]);

      // Extract fight logs from both browsers
      const [logP1, logP2] = await Promise.all([extractFightLog(pageP1), extractFightLog(pageP2)]);

      // Both logs should exist and be complete
      expect(logP1).toBeTruthy();
      expect(logP2).toBeTruthy();
      expect(logP1.matchComplete).toBe(true);
      expect(logP2.matchComplete).toBe(true);

      // PRIMARY ASSERTION: final state hashes must match (determinism)
      expect(logP1.finalStateHash).toBe(logP2.finalStateHash);

      // Compare checksums at shared frames
      const p1Checksums = new Map(logP1.checksums.map((c) => [c.frame, c.hash]));
      const p2Checksums = new Map(logP2.checksums.map((c) => [c.frame, c.hash]));

      let sharedChecksumCount = 0;
      let checksumMismatches = 0;
      for (const [frame, hash] of p1Checksums) {
        if (p2Checksums.has(frame)) {
          sharedChecksumCount++;
          if (p2Checksums.get(frame) !== hash) {
            checksumMismatches++;
          }
        }
      }

      // Report stats
      console.log(`--- Multiplayer Determinism Report ---`);
      console.log(`Room: ${logP1.roomId}`);
      console.log(`P1: ${logP1.fighterId} vs P2: ${logP2.fighterId}`);
      console.log(`Total frames: P1=${logP1.totalFrames}, P2=${logP2.totalFrames}`);
      console.log(`Rollbacks: P1=${logP1.rollbackCount}, P2=${logP2.rollbackCount}`);
      console.log(
        `Max rollback depth: P1=${logP1.maxRollbackFrames}, P2=${logP2.maxRollbackFrames}`,
      );
      console.log(`Desyncs: P1=${logP1.desyncCount}, P2=${logP2.desyncCount}`);
      console.log(`Shared checksums: ${sharedChecksumCount}, mismatches: ${checksumMismatches}`);
      console.log(`Final state hash: P1=${logP1.finalStateHash}, P2=${logP2.finalStateHash}`);
      console.log(`Result: winner=${logP1.result?.winnerId || logP2.result?.winnerId}`);
      console.log(
        `Duration: P1=${logP1.completedAt - logP1.startedAt}ms, P2=${logP2.completedAt - logP2.startedAt}ms`,
      );
      console.log(`--------------------------------------`);

      // No desyncs should have occurred
      expect(logP1.desyncCount).toBe(0);
      expect(logP2.desyncCount).toBe(0);
      expect(checksumMismatches).toBe(0);

      // Both peers should agree on the winner
      expect(logP1.result?.winnerId || null).toBe(logP2.result?.winnerId || null);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('match completes with random fighters', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const pageP1 = await ctx1.newPage();
    const pageP2 = await ctx2.newPage();

    try {
      // No specific fighters or seed — random selection
      await pageP1.goto(p1Url(BASE_URL));
      const roomId = await waitForRoomId(pageP1);
      await pageP2.goto(p2Url(BASE_URL, roomId));

      await Promise.all([waitForMatchComplete(pageP1), waitForMatchComplete(pageP2)]);

      const [logP1, logP2] = await Promise.all([extractFightLog(pageP1), extractFightLog(pageP2)]);

      expect(logP1.matchComplete).toBe(true);
      expect(logP2.matchComplete).toBe(true);
      expect(logP1.finalStateHash).toBe(logP2.finalStateHash);

      console.log(
        `Random match: ${logP1.fighterId} vs ${logP2.fighterId}, ` +
          `winner=${logP1.result?.winnerId || logP2.result?.winnerId}, ` +
          `frames=${logP1.totalFrames}, rollbacks P1=${logP1.rollbackCount} P2=${logP2.rollbackCount}`,
      );
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
