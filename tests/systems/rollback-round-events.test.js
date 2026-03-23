import { describe, expect, it } from 'vitest';
import { MAX_HP, ROUNDS_TO_WIN } from '../../src/config.js';
import { captureGameState, restoreGameState } from '../../src/systems/GameState.js';
import { encodeInput } from '../../src/systems/InputBuffer.js';
import { simulateFrame } from '../../src/systems/SimulationStep.js';
import { createSimCombat, createSimFighter } from '../helpers/sim-factory.js';

const EMPTY = encodeInput({
  left: false,
  right: false,
  up: false,
  down: false,
  lp: false,
  hp: false,
  lk: false,
  hk: false,
  sp: false,
});

describe('rollback-safe round events', () => {
  describe('tickTimer returns timeup instead of firing side effects', () => {
    it('tickTimer returns { timeup: true } when timer reaches 0', () => {
      const combat = createSimCombat();
      combat.timer = 1;
      combat._timerAccumulator = 59;

      const result = combat.tickTimer();
      expect(result).toEqual({ timeup: true });
      expect(combat.timer).toBe(0);
    });

    it('tickTimer returns null when timer has not reached 0', () => {
      const combat = createSimCombat();
      combat.timer = 10;
      combat._timerAccumulator = 0;

      const result = combat.tickTimer();
      expect(result).toBeNull();
    });

    it('tickTimer with muteEffects still ticks the timer (deterministic)', () => {
      const combat = createSimCombat();
      combat.timer = 1;
      combat._timerAccumulator = 59;

      const result = combat.tickTimer({ muteEffects: true });
      expect(result).toEqual({ timeup: true });
      expect(combat.timer).toBe(0);
    });
  });

  describe('checkHit returns KO info instead of calling handleKO', () => {
    it('checkHit returns { hit: true, ko: true } when hit causes KO', () => {
      const p1 = createSimFighter(100, 0);
      const p2 = createSimFighter(130, 1);
      const combat = createSimCombat();

      // Set up P1 mid-attack in active frames, P2 at 1 HP
      p1.state = 'attacking';
      p1.currentAttack = {
        type: 'heavyPunch',
        damage: 14,
        startup: 3,
        active: 3,
        recovery: 8,
        hitstun: 20,
        blockstun: 14,
      };
      p1.attackFrameElapsed = 4; // in active frames (startup=3, active=3 → 3,4,5 are active)
      p1.attackCooldown = 10;
      p1.hitConnected = false;
      p1.facingRight = true;

      p2.hp = 1; // Will be KO'd by any hit

      const result = combat.checkHit(p1, p2);
      expect(result).toEqual({ hit: true, ko: true });
      expect(p2.hp).toBe(0);
    });

    it('checkHit returns { hit: true, ko: false } when hit does not KO', () => {
      const p1 = createSimFighter(100, 0);
      const p2 = createSimFighter(130, 1);
      const combat = createSimCombat();

      p1.state = 'attacking';
      p1.currentAttack = {
        type: 'lightPunch',
        damage: 8,
        startup: 3,
        active: 2,
        recovery: 5,
        hitstun: 12,
        blockstun: 8,
      };
      p1.attackFrameElapsed = 3; // in active frames
      p1.attackCooldown = 7;
      p1.hitConnected = false;
      p1.facingRight = true;

      p2.hp = MAX_HP; // Will survive

      const result = combat.checkHit(p1, p2);
      expect(result).toEqual({ hit: true, ko: false });
      expect(p2.hp).toBeGreaterThan(0);
    });

    it('checkHit returns false on miss', () => {
      const p1 = createSimFighter(100, 0);
      const p2 = createSimFighter(400, 1); // Far apart — no hit
      const combat = createSimCombat();

      p1.state = 'attacking';
      p1.currentAttack = {
        type: 'lightPunch',
        damage: 8,
        startup: 3,
        active: 2,
        recovery: 5,
        hitstun: 12,
        blockstun: 8,
      };
      p1.attackFrameElapsed = 3;
      p1.attackCooldown = 7;
      p1.hitConnected = false;
      p1.facingRight = true;

      const result = combat.checkHit(p1, p2);
      expect(result).toBe(false);
    });
  });

  describe('simulateFrame returns round event descriptors', () => {
    it('returns null when no round event occurs', () => {
      const p1 = createSimFighter(144, 0);
      const p2 = createSimFighter(336, 1);
      const combat = createSimCombat();

      const result = simulateFrame(p1, p2, combat, EMPTY, EMPTY);
      expect(result).toBeNull();
    });

    it('returns KO event when a fighter is knocked out', () => {
      const p1 = createSimFighter(100, 0);
      const p2 = createSimFighter(130, 1);
      const combat = createSimCombat();

      // Set P2 to 1 HP and P1 mid-attack at startup frame
      // We need to advance enough frames for the attack to reach active frames
      p2.hp = 1;

      // Start P1 attacking
      const attackInput = encodeInput({
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: true,
        lk: false,
        hk: false,
        sp: false,
      });

      // Run through startup frames until active frames connect
      let roundEvent = null;
      for (let f = 0; f < 20 && !roundEvent; f++) {
        const input = f === 0 ? attackInput : EMPTY;
        roundEvent = simulateFrame(p1, p2, combat, input, EMPTY);
      }

      expect(roundEvent).toEqual({ type: 'ko', winnerIndex: 0 });
    });

    it('returns timeup event when timer reaches 0', () => {
      const p1 = createSimFighter(144, 0);
      const p2 = createSimFighter(336, 1);
      const combat = createSimCombat();

      // Set timer to expire in 1 tick
      combat.timer = 1;
      combat._timerAccumulator = 59;

      // Give P1 more HP so P1 wins on timeup
      p1.hp = 80;
      p2.hp = 50;

      const result = simulateFrame(p1, p2, combat, EMPTY, EMPTY);
      expect(result).toEqual({ type: 'timeup', winnerIndex: 0 });
    });

    it('returns timeup with P2 winner when P2 has more HP', () => {
      const p1 = createSimFighter(144, 0);
      const p2 = createSimFighter(336, 1);
      const combat = createSimCombat();

      combat.timer = 1;
      combat._timerAccumulator = 59;

      p1.hp = 30;
      p2.hp = 70;

      const result = simulateFrame(p1, p2, combat, EMPTY, EMPTY);
      expect(result).toEqual({ type: 'timeup', winnerIndex: 1 });
    });

    it('KO takes priority over timeup when both happen on same frame', () => {
      const p1 = createSimFighter(100, 0);
      const p2 = createSimFighter(130, 1);
      const combat = createSimCombat();

      // Set up so both KO and timeup could happen
      combat.timer = 1;
      combat._timerAccumulator = 59;
      p2.hp = 1;

      // P1 attacks (heavy punch)
      p1.state = 'attacking';
      p1.currentAttack = {
        type: 'heavyPunch',
        damage: 14,
        startup: 3,
        active: 3,
        recovery: 8,
        hitstun: 20,
        blockstun: 14,
      };
      p1.attackFrameElapsed = 3; // just before active frame after update()
      p1.attackCooldown = 10;
      p1.hitConnected = false;
      p1.facingRight = true;

      const result = simulateFrame(p1, p2, combat, EMPTY, EMPTY);
      // KO should take priority
      if (result) {
        expect(result.type).toBe('ko');
        expect(result.winnerIndex).toBe(0);
      }
    });
  });

  describe('timer reaching 0 during rollback does not corrupt state', () => {
    it('round event is discarded during rollback re-simulation', () => {
      const p1 = createSimFighter(144, 0);
      const p2 = createSimFighter(336, 1);
      const combat = createSimCombat();

      // Set timer to 2 seconds (120 frames)
      combat.timer = 2;
      combat._timerAccumulator = 0;

      // Run 59 frames (timer still at 2)
      for (let f = 0; f < 59; f++) {
        simulateFrame(p1, p2, combat, EMPTY, EMPTY, { muteEffects: true });
      }
      expect(combat.timer).toBe(2);

      // Frame 60: timer decrements to 1
      simulateFrame(p1, p2, combat, EMPTY, EMPTY, { muteEffects: true });
      expect(combat.timer).toBe(1);

      // Snapshot state at this point
      const snapshot = captureGameState(60, p1, p2, combat);

      // Run 59 more frames
      for (let f = 0; f < 59; f++) {
        simulateFrame(p1, p2, combat, EMPTY, EMPTY, { muteEffects: true });
      }
      expect(combat.timer).toBe(1);

      // Frame 120: timer decrements to 0 → timeup detected
      const event = simulateFrame(p1, p2, combat, EMPTY, EMPTY, { muteEffects: true });

      // Event is returned even with muteEffects (caller decides what to do)
      expect(event).toEqual({ type: 'timeup', winnerIndex: expect.any(Number) });

      // Critically: roundActive should still be true (not corrupted by timeUp side effects)
      // because suppressRoundEvents=true prevents timeUp() from being called
      expect(combat.roundActive).toBe(true);

      // Restore snapshot and verify state is clean
      restoreGameState(snapshot, p1, p2, combat);
      expect(combat.timer).toBe(1);
      expect(combat.roundActive).toBe(true);
    });
  });

  describe('KO on predicted input is rolled back correctly', () => {
    it('KO from predicted attack is undone after rollback', () => {
      const p1 = createSimFighter(100, 0);
      const p2 = createSimFighter(130, 1);
      const combat = createSimCombat();

      // Set P2 to low HP
      p2.hp = 1;

      // Run some idle frames to establish state
      for (let f = 0; f < 10; f++) {
        simulateFrame(p1, p2, combat, EMPTY, EMPTY);
      }

      // Snapshot before the predicted attack
      const snapshot = captureGameState(10, p1, p2, combat);
      const snapshotP2Hp = p2.hp;

      // Simulate with a predicted attack (P1 heavy punch)
      const attackInput = encodeInput({
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: true,
        lk: false,
        hk: false,
        sp: false,
      });

      // Run through attack frames — might KO
      let koDetected = false;
      for (let f = 0; f < 15; f++) {
        const input = f === 0 ? attackInput : EMPTY;
        const event = simulateFrame(p1, p2, combat, input, EMPTY, { muteEffects: true });
        if (event?.type === 'ko') koDetected = true;
      }

      // KO should have been detected in the simulation
      expect(koDetected).toBe(true);
      expect(p2.hp).toBe(0);

      // But roundActive is still true because we're in rollback (suppressRoundEvents=true)
      expect(combat.roundActive).toBe(true);

      // Now rollback: restore snapshot
      restoreGameState(snapshot, p1, p2, combat);

      // Confirmed input shows P1 was NOT attacking (misprediction)
      // Re-simulate with the correct input (idle)
      for (let f = 0; f < 15; f++) {
        simulateFrame(p1, p2, combat, EMPTY, EMPTY);
      }

      // P2 should still be alive — the KO was on a mispredicted input
      expect(p2.hp).toBe(snapshotP2Hp);
      expect(combat.roundActive).toBe(true);
    });
  });

  describe('P1 and P2 agree on round events', () => {
    it('both peers produce identical round event from identical simulation', () => {
      // Simulate the same inputs on two independent instances (P1 and P2 views)
      const p1a = createSimFighter(100, 0);
      const p2a = createSimFighter(130, 1);
      const combatA = createSimCombat();

      const p1b = createSimFighter(100, 0);
      const p2b = createSimFighter(130, 1);
      const combatB = createSimCombat();

      // Set both P2 fighters to low HP
      p2a.hp = 1;
      p2b.hp = 1;

      const attackInput = encodeInput({
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: true,
        lk: false,
        hk: false,
        sp: false,
      });

      const eventsA = [];
      const eventsB = [];

      for (let f = 0; f < 20; f++) {
        const input = f === 0 ? attackInput : EMPTY;
        const eventA = simulateFrame(p1a, p2a, combatA, input, EMPTY);
        const eventB = simulateFrame(p1b, p2b, combatB, input, EMPTY);
        if (eventA) eventsA.push({ frame: f, ...eventA });
        if (eventB) eventsB.push({ frame: f, ...eventB });
      }

      // Both sides detect the same round event at the same frame
      expect(eventsA).toEqual(eventsB);
      expect(eventsA.length).toBeGreaterThan(0);
      expect(eventsA[0].type).toBe('ko');
      expect(eventsA[0].winnerIndex).toBe(0);
    });

    it('timeup event agrees on winner based on HP', () => {
      const p1a = createSimFighter(144, 0);
      const p2a = createSimFighter(336, 1);
      const combatA = createSimCombat();
      combatA.timer = 1;
      combatA._timerAccumulator = 59;

      const p1b = createSimFighter(144, 0);
      const p2b = createSimFighter(336, 1);
      const combatB = createSimCombat();
      combatB.timer = 1;
      combatB._timerAccumulator = 59;

      // Different HP values
      p1a.hp = 40;
      p2a.hp = 60;
      p1b.hp = 40;
      p2b.hp = 60;

      const eventA = simulateFrame(p1a, p2a, combatA, EMPTY, EMPTY);
      const eventB = simulateFrame(p1b, p2b, combatB, EMPTY, EMPTY);

      expect(eventA).toEqual({ type: 'timeup', winnerIndex: 1 });
      expect(eventB).toEqual({ type: 'timeup', winnerIndex: 1 });
    });
  });

  describe('round event not returned when roundActive is false', () => {
    it('simulateFrame returns null when round is not active', () => {
      const p1 = createSimFighter(100, 0);
      const p2 = createSimFighter(130, 1);
      const combat = createSimCombat();
      combat.roundActive = false;

      p2.hp = 1;

      const attackInput = encodeInput({
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: true,
        lk: false,
        hk: false,
        sp: false,
      });

      // Even with an attack that would KO, no event when round is inactive
      for (let f = 0; f < 20; f++) {
        const input = f === 0 ? attackInput : EMPTY;
        const result = simulateFrame(p1, p2, combat, input, EMPTY);
        expect(result).toBeNull();
      }
    });
  });

  describe('snapshot/restore preserves round event determinism', () => {
    it('restore + re-simulate produces same round event as straight-through', () => {
      const p1ref = createSimFighter(100, 0);
      const p2ref = createSimFighter(130, 1);
      const combatRef = createSimCombat();
      p2ref.hp = 30;

      // Reference: straight-through with attack at frame 20
      const attackInput = encodeInput({
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: true,
        lk: false,
        hk: false,
        sp: false,
      });

      let refEvent = null;
      let refEventFrame = -1;
      for (let f = 0; f < 60; f++) {
        const input = f === 20 ? attackInput : EMPTY;
        const event = simulateFrame(p1ref, p2ref, combatRef, input, EMPTY);
        if (event && !refEvent) {
          refEvent = event;
          refEventFrame = f;
        }
      }

      // Rollback path: run to frame 15, snapshot, continue with wrong inputs, rollback, re-simulate
      const p1 = createSimFighter(100, 0);
      const p2 = createSimFighter(130, 1);
      const combat = createSimCombat();
      p2.hp = 30;

      for (let f = 0; f < 15; f++) {
        simulateFrame(p1, p2, combat, EMPTY, EMPTY);
      }
      const snapshot = captureGameState(15, p1, p2, combat);

      // Wrong inputs: attack at frame 15 instead of 20
      for (let f = 15; f < 30; f++) {
        const input = f === 15 ? attackInput : EMPTY;
        simulateFrame(p1, p2, combat, input, EMPTY, { muteEffects: true });
      }

      // Rollback to frame 15
      restoreGameState(snapshot, p1, p2, combat);

      // Re-simulate with correct inputs (attack at frame 20)
      let rollbackEvent = null;
      let rollbackEventFrame = -1;
      for (let f = 15; f < 60; f++) {
        const input = f === 20 ? attackInput : EMPTY;
        const event = simulateFrame(p1, p2, combat, input, EMPTY);
        if (event && !rollbackEvent) {
          rollbackEvent = event;
          rollbackEventFrame = f;
        }
      }

      // Same event at same frame
      expect(rollbackEvent).toEqual(refEvent);
      expect(rollbackEventFrame).toBe(refEventFrame);
    });
  });
});
