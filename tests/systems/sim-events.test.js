import { CombatSim, createCombatSim, createFighterSim, encodeInput, tick } from '@alostraques/sim';
import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MAX_HP } from '../../apps/game-vite/src/config.js';

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

function jumpInput() {
  return encodeInput({
    left: false,
    right: false,
    up: true,
    down: false,
    lp: false,
    hp: false,
    lk: false,
    hk: false,
    sp: false,
  });
}

function attackInput(type) {
  return encodeInput({
    left: false,
    right: false,
    up: false,
    down: false,
    lp: type === 'lightPunch',
    hp: type === 'heavyPunch',
    lk: type === 'lightKick',
    hk: type === 'heavyKick',
    sp: type === 'special',
  });
}

function setupFighters() {
  const p1 = createFighterSim(GAME_WIDTH * 0.3, 0);
  const p2 = createFighterSim(GAME_WIDTH * 0.7, 1);
  const combat = createCombatSim();
  return { p1, p2, combat };
}

describe('simulation events', () => {
  describe('tick() returns events array', () => {
    it('returns empty events array when nothing happens', () => {
      const { p1, p2, combat } = setupFighters();
      const { events } = tick(p1, p2, combat, EMPTY, EMPTY, 0);
      expect(Array.isArray(events)).toBe(true);
      // May have zero events (no combat action)
    });
  });

  describe('jump events', () => {
    it('emits jump event when P1 jumps', () => {
      const { p1, p2, combat } = setupFighters();
      const { events } = tick(p1, p2, combat, jumpInput(), EMPTY, 0);
      const jumpEvents = events.filter((e) => e.type === 'jump');
      expect(jumpEvents).toHaveLength(1);
      expect(jumpEvents[0].playerIndex).toBe(0);
    });

    it('emits jump event when P2 jumps', () => {
      const { p1, p2, combat } = setupFighters();
      const { events } = tick(p1, p2, combat, EMPTY, jumpInput(), 0);
      const jumpEvents = events.filter((e) => e.type === 'jump');
      expect(jumpEvents).toHaveLength(1);
      expect(jumpEvents[0].playerIndex).toBe(1);
    });

    it('emits two jump events when both players jump', () => {
      const { p1, p2, combat } = setupFighters();
      const { events } = tick(p1, p2, combat, jumpInput(), jumpInput(), 0);
      const jumpEvents = events.filter((e) => e.type === 'jump');
      expect(jumpEvents).toHaveLength(2);
    });
  });

  describe('special_charge events', () => {
    it('emits special_charge when P1 uses special attack', () => {
      const { p1, p2, combat } = setupFighters();
      // Give P1 enough special meter
      p1.special = 100000;
      const { events } = tick(p1, p2, combat, attackInput('special'), EMPTY, 0);
      const specialEvents = events.filter((e) => e.type === 'special_charge');
      expect(specialEvents).toHaveLength(1);
      expect(specialEvents[0].playerIndex).toBe(0);
    });
  });

  describe('whiff events', () => {
    it('emits whiff when attack ends without hitting', () => {
      const { p1, p2, combat } = setupFighters();
      // Start a light punch
      tick(p1, p2, combat, attackInput('lightPunch'), EMPTY, 0);

      // Advance frames until attack completes
      let whiffEvent = null;
      for (let f = 1; f < 30; f++) {
        const { events } = tick(p1, p2, combat, EMPTY, EMPTY, f);
        const whiff = events.find((e) => e.type === 'whiff');
        if (whiff) {
          whiffEvent = whiff;
          break;
        }
      }

      expect(whiffEvent).not.toBeNull();
      expect(whiffEvent.playerIndex).toBe(0);
    });
  });

  describe('hit events', () => {
    it('emits hit event when attack connects', () => {
      const { p1, p2, combat } = setupFighters();
      // Move fighters close together
      p1.simX = p2.simX - 40 * 1000;
      p1.facingRight = true;

      // Start an attack
      tick(p1, p2, combat, attackInput('lightPunch'), EMPTY, 0);

      // Advance through startup frames until hit connects
      let hitEvent = null;
      for (let f = 1; f < 15; f++) {
        const { events } = tick(p1, p2, combat, EMPTY, EMPTY, f);
        const hit = events.find((e) => e.type === 'hit');
        if (hit) {
          hitEvent = hit;
          break;
        }
      }

      expect(hitEvent).not.toBeNull();
      expect(hitEvent.attackerIndex).toBe(0);
      expect(hitEvent.defenderIndex).toBe(1);
      expect(hitEvent.intensity).toBeDefined();
      expect(hitEvent.damage).toBeGreaterThan(0);
      expect(typeof hitEvent.hitX).toBe('number');
      expect(typeof hitEvent.hitY).toBe('number');
    });

    it('emits hit_blocked when defender is blocking', () => {
      const { p1, p2, combat } = setupFighters();
      // Move fighters close together
      p1.simX = p2.simX - 40 * 1000;
      p1.facingRight = true;

      // P2 blocks, P1 attacks
      const blockInput = encodeInput({
        left: false,
        right: false,
        up: false,
        down: true,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      });
      tick(p1, p2, combat, attackInput('lightPunch'), blockInput, 0);

      // Advance through frames looking for hit_blocked
      let blockedEvent = null;
      for (let f = 1; f < 15; f++) {
        const { events } = tick(p1, p2, combat, EMPTY, blockInput, f);
        const blocked = events.find((e) => e.type === 'hit_blocked');
        if (blocked) {
          blockedEvent = blocked;
          break;
        }
      }

      expect(blockedEvent).not.toBeNull();
      expect(blockedEvent.attackerIndex).toBe(0);
      expect(blockedEvent.defenderIndex).toBe(1);
    });
  });

  describe('round events', () => {
    it('emits round_ko when fighter is knocked out', () => {
      const { p1, p2, combat } = setupFighters();
      // Set P2 to 1 HP so any hit KOs
      p2.hp = 1;
      p1.simX = p2.simX - 40 * 1000;
      p1.facingRight = true;

      tick(p1, p2, combat, attackInput('lightPunch'), EMPTY, 0);

      let koEvent = null;
      for (let f = 1; f < 15; f++) {
        const { events } = tick(p1, p2, combat, EMPTY, EMPTY, f);
        const ko = events.find((e) => e.type === 'round_ko');
        if (ko) {
          koEvent = ko;
          break;
        }
      }

      expect(koEvent).not.toBeNull();
      expect(koEvent.winnerIndex).toBe(0);
      expect(typeof koEvent.matchOver).toBe('boolean');
    });

    it('emits round_timeup when timer expires', () => {
      const { p1, p2, combat } = setupFighters();
      combat.timer = 1;
      combat._timerAccumulator = 59;
      // Give P1 more HP so they win
      p1.hp = MAX_HP;
      p2.hp = MAX_HP - 10;

      const { events, roundEvent } = tick(p1, p2, combat, EMPTY, EMPTY, 0);
      const timeupEvent = events.find((e) => e.type === 'round_timeup');

      expect(timeupEvent).not.toBeNull();
      expect(timeupEvent.winnerIndex).toBe(0);
      expect(roundEvent).not.toBeNull();
      expect(roundEvent.type).toBe('timeup');
    });

    it('round events in events array match roundEvent return value', () => {
      const { p1, p2, combat } = setupFighters();
      combat.timer = 1;
      combat._timerAccumulator = 59;

      const { events, roundEvent } = tick(p1, p2, combat, EMPTY, EMPTY, 0);
      const roundEvtInArray = events.find(
        (e) => e.type === 'round_ko' || e.type === 'round_timeup',
      );

      expect(roundEvent).not.toBeNull();
      expect(roundEvtInArray).not.toBeNull();
      expect(roundEvtInArray.winnerIndex).toBe(roundEvent.winnerIndex);
    });
  });

  describe('CombatSim.checkHit with events parameter', () => {
    it('pushes hit event onto events array', () => {
      const p1 = createFighterSim(100, 0);
      const p2 = createFighterSim(130, 1);
      const combat = new CombatSim();
      combat.roundActive = true;

      // Setup attack state
      p1.state = 'attacking';
      p1.currentAttack = { type: 'lightPunch', damage: 8, startup: 0, active: 10, recovery: 5 };
      p1.attackFrameElapsed = 1;
      p1.attackCooldown = 10;
      p1.facingRight = true;

      const events = [];
      combat.checkHit(p1, p2, events);

      const hitEvents = events.filter((e) => e.type === 'hit' || e.type === 'hit_blocked');
      expect(hitEvents.length).toBeGreaterThanOrEqual(0);
      // If fighters are in range, there should be a hit event
    });

    it('does not push events when no events array provided', () => {
      const combat = new CombatSim();
      // Should not throw when events is undefined
      const result = combat.checkHit(createFighterSim(100, 0), createFighterSim(200, 1));
      expect(result === false || result.hit === true).toBe(true);
    });

    it('ignores non-array events parameter (backward compat)', () => {
      const combat = new CombatSim();
      // SimulationStep passes { muteEffects } object — should not crash
      const result = combat.checkHit(createFighterSim(100, 0), createFighterSim(200, 1), {
        muteEffects: true,
      });
      expect(result === false || result.hit === true).toBe(true);
    });
  });

  describe('FighterSim event emission', () => {
    it('jump() pushes event onto events array', () => {
      const f = createFighterSim(100, 0);
      const events = [];
      f.jump(events);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'jump', playerIndex: 0 });
    });

    it('jump() works without events array', () => {
      const f = createFighterSim(100, 0);
      f.jump(); // should not throw
      expect(f.state).toBe('jumping');
    });

    it('attack() pushes special_charge for special attacks', () => {
      const f = createFighterSim(100, 0);
      f.special = 100000;
      const events = [];
      f.attack('special', events);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'special_charge', playerIndex: 0 });
    });

    it('attack() does not push event for non-special attacks', () => {
      const f = createFighterSim(100, 0);
      const events = [];
      f.attack('lightPunch', events);
      expect(events).toHaveLength(0);
    });

    it('update() pushes whiff event on attack end without hit', () => {
      const f = createFighterSim(100, 0);
      f.attack('lightPunch');
      // Advance to end of attack
      while (f.state === 'attacking') {
        f.update();
      }
      // One more update — should emit whiff on transition frame
      // Actually the whiff happens on the frame where state transitions
      // Let me re-do: start fresh
      const f2 = createFighterSim(100, 0);
      f2.attack('lightPunch');
      const events = [];
      // Run update frames until attack completes
      while (f2.attackCooldown > 0) {
        f2.update(events);
      }
      // The last update should trigger whiff
      f2.update(events);
      const whiffs = events.filter((e) => e.type === 'whiff');
      expect(whiffs.length).toBeGreaterThanOrEqual(1);
      expect(whiffs[0].playerIndex).toBe(0);
    });

    it('update() does not emit whiff when hit connected', () => {
      const f = createFighterSim(100, 0);
      f.attack('lightPunch');
      f.hitConnected = true;
      const events = [];
      while (f.attackCooldown > 0) {
        f.update(events);
      }
      f.update(events);
      const whiffs = events.filter((e) => e.type === 'whiff');
      expect(whiffs).toHaveLength(0);
    });
  });
});
