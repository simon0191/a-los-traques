/**
 * Pure deterministic simulation engine — no Phaser dependency.
 * tick() returns a NEW state object (immutable). Past return values
 * serve as the rollback snapshot window.
 *
 * Frame-based — no delta time.
 */
import { GAME_WIDTH, ROUND_TIME, ROUND_TRANSITION_FRAMES, ROUNDS_TO_WIN } from '../config.js';
import { FP_SCALE } from '../systems/FixedPoint.js';
import { decodeInput } from '../systems/InputBuffer.js';

const P1_START_X = GAME_WIDTH * 0.3;
const P2_START_X = GAME_WIDTH * 0.7;

/** Snapshot format version — increment when snapshot shape changes. */
export const SNAPSHOT_VERSION = 1;

/**
 * Apply decoded input to a FighterSim.
 */
export function applyInputToFighter(fighter, inputState) {
  const speed = (80 + fighter.data.stats.speed * 20) * FP_SCALE;

  if (inputState.left) {
    fighter.moveLeft(speed);
  } else if (inputState.right) {
    fighter.moveRight(speed);
  } else {
    fighter.stop();
  }

  if (inputState.up) fighter.jump();
  if (inputState.down && fighter.isOnGround) fighter.block();

  if (inputState.lp) fighter.attack('lightPunch');
  else if (inputState.hp) fighter.attack('heavyPunch');
  else if (inputState.lk) fighter.attack('lightKick');
  else if (inputState.hk) fighter.attack('heavyKick');
  else if (inputState.sp) fighter.attack('special');
}

/**
 * Clone a fighter's mutable state into a plain object.
 */
export function captureFighterState(f) {
  return {
    simX: f.simX,
    simY: f.simY,
    simVX: f.simVX,
    simVY: f.simVY,
    hp: f.hp,
    special: f.special,
    stamina: f.stamina,
    state: f.state,
    attackCooldown: f.attackCooldown,
    attackFrameElapsed: f.attackFrameElapsed,
    comboCount: f.comboCount,
    blockTimer: f.blockTimer,
    hurtTimer: f.hurtTimer,
    hitConnected: f.hitConnected,
    currentAttack: f.currentAttack ? { ...f.currentAttack } : null,
    isOnGround: f.isOnGround,
    _airborneTime: f._airborneTime,
    hasDoubleJumped: f.hasDoubleJumped,
    facingRight: f.facingRight,
    _isTouchingWall: f._isTouchingWall,
    _wallDir: f._wallDir,
    _hasWallJumped: f._hasWallJumped,
    _prevAnimState: f._prevAnimState,
    _specialTintTimer: f._specialTintTimer,
  };
}

/**
 * Clone combat state into a plain object.
 */
export function captureCombatState(c) {
  return {
    roundNumber: c.roundNumber,
    p1RoundsWon: c.p1RoundsWon,
    p2RoundsWon: c.p2RoundsWon,
    timer: c.timer,
    roundActive: c.roundActive,
    matchOver: c.matchOver,
    _timerAccumulator: c._timerAccumulator,
    transitionTimer: c.transitionTimer,
  };
}

/**
 * Restore fighter state from a plain snapshot object.
 */
export function restoreFighterState(fighter, snap) {
  fighter.simX = snap.simX;
  fighter.simY = snap.simY;
  fighter.simVX = snap.simVX;
  fighter.simVY = snap.simVY;
  fighter.hp = snap.hp;
  fighter.special = snap.special;
  fighter.stamina = snap.stamina;
  fighter.state = snap.state;
  fighter.attackCooldown = snap.attackCooldown;
  fighter.attackFrameElapsed = snap.attackFrameElapsed;
  fighter.comboCount = snap.comboCount;
  fighter.blockTimer = snap.blockTimer;
  fighter.hurtTimer = snap.hurtTimer;
  fighter.hitConnected = snap.hitConnected;
  fighter.currentAttack = snap.currentAttack ? { ...snap.currentAttack } : null;
  fighter.isOnGround = snap.isOnGround;
  fighter._airborneTime = snap._airborneTime;
  fighter.hasDoubleJumped = snap.hasDoubleJumped;
  fighter.facingRight = snap.facingRight;
  fighter._isTouchingWall = snap._isTouchingWall;
  fighter._wallDir = snap._wallDir;
  fighter._hasWallJumped = snap._hasWallJumped;
  fighter._prevAnimState = snap._prevAnimState;
  fighter._specialTintTimer = snap._specialTintTimer;
}

/**
 * Restore combat state from a plain snapshot object.
 */
export function restoreCombatState(combat, snap) {
  combat.roundNumber = snap.roundNumber;
  combat.p1RoundsWon = snap.p1RoundsWon;
  combat.p2RoundsWon = snap.p2RoundsWon;
  combat.timer = snap.timer;
  combat.roundActive = snap.roundActive;
  combat.matchOver = snap.matchOver;
  combat._timerAccumulator = snap._timerAccumulator;
  combat.transitionTimer = snap.transitionTimer;
}

/**
 * Capture a full game state snapshot from live FighterSim + CombatSim objects.
 */
export function captureGameState(frame, p1, p2, combat) {
  return {
    version: SNAPSHOT_VERSION,
    frame,
    p1: captureFighterState(p1),
    p2: captureFighterState(p2),
    combat: captureCombatState(combat),
  };
}

/**
 * Restore full game state into live FighterSim + CombatSim objects.
 */
export function restoreGameState(snapshot, p1, p2, combat) {
  restoreFighterState(p1, snapshot.p1);
  restoreFighterState(p2, snapshot.p2);
  restoreCombatState(combat, snapshot.combat);
}

/**
 * Compute a fast hash of a game state snapshot for desync detection.
 * XOR-rotate hash over key integer fields.
 * @param {object} snapshot
 * @returns {number} 32-bit integer hash
 */
export function hashGameState(snapshot) {
  let h = 0;
  const vals = [
    snapshot.p1.simX,
    snapshot.p1.simY,
    snapshot.p1.hp,
    snapshot.p1.special,
    snapshot.p1.stamina,
    snapshot.p1.attackCooldown,
    snapshot.p1.hurtTimer,
    snapshot.p2.simX,
    snapshot.p2.simY,
    snapshot.p2.hp,
    snapshot.p2.special,
    snapshot.p2.stamina,
    snapshot.p2.attackCooldown,
    snapshot.p2.hurtTimer,
    snapshot.combat.timer,
    snapshot.combat.roundNumber,
    snapshot.combat.transitionTimer || 0,
    snapshot.combat.roundActive ? 1 : 0,
    snapshot.combat.p1RoundsWon,
    snapshot.combat.p2RoundsWon,
  ];
  for (const v of vals) {
    h = ((h << 5) | (h >>> 27)) ^ (v | 0);
  }
  return h;
}

/**
 * Run one deterministic simulation frame.
 * Mutates p1, p2, combat in place, then returns a cloned snapshot.
 *
 * @param {import('./FighterSim.js').FighterSim} p1 - Player 1 fighter (mutated)
 * @param {import('./FighterSim.js').FighterSim} p2 - Player 2 fighter (mutated)
 * @param {import('./CombatSim.js').CombatSim} combat - Combat state (mutated)
 * @param {number} p1Input - Encoded input for P1
 * @param {number} p2Input - Encoded input for P2
 * @param {number} frame - Current frame number
 * @returns {{ state: object, roundEvent: object | null }}
 */
export function tick(p1, p2, combat, p1Input, p2Input, frame) {
  // 1. Update fighters (gravity, cooldowns, timers, ground check)
  p1.update();
  p2.update();

  // 2. Apply inputs
  const p1State = decodeInput(p1Input);
  const p2State = decodeInput(p2Input);
  applyInputToFighter(p1, p1State);
  applyInputToFighter(p2, p2State);

  // 3. Resolve body collision
  combat.resolveBodyCollision(p1, p2);

  // 4. Face opponent
  p1.faceOpponent(p2);
  p2.faceOpponent(p1);

  // 5. Hit detection + timer tick (only when round is active)
  let roundEvent = null;
  if (combat.roundActive) {
    const p1Hit = combat.checkHit(p1, p2);
    const p2Hit = combat.checkHit(p2, p1);

    if (p1Hit?.ko) roundEvent = { type: 'ko', winnerIndex: 0 };
    else if (p2Hit?.ko) roundEvent = { type: 'ko', winnerIndex: 1 };

    const timerResult = combat.tickTimer();
    if (!roundEvent && timerResult?.timeup) {
      roundEvent = {
        type: 'timeup',
        winnerIndex: p1.hp >= p2.hp ? 0 : 1,
      };
    }

    // Update simulation state on round event (deterministic, both peers agree)
    if (roundEvent) {
      combat.roundActive = false;
      p1.simVX = 0;
      p2.simVX = 0;
      if (roundEvent.winnerIndex === 0) combat.p1RoundsWon++;
      else combat.p2RoundsWon++;
      combat.roundNumber++;
      if (combat.p1RoundsWon >= ROUNDS_TO_WIN || combat.p2RoundsWon >= ROUNDS_TO_WIN) {
        combat.matchOver = true;
      }
      if (!combat.matchOver) {
        combat.transitionTimer = ROUND_TRANSITION_FRAMES;
      }
    }
  }

  // 6. Tick transition timer — deterministic round reset
  if (!combat.roundActive && combat.transitionTimer > 0) {
    combat.transitionTimer--;
    if (combat.transitionTimer <= 0 && !combat.matchOver) {
      p1.resetForRound(P1_START_X);
      p2.resetForRound(P2_START_X);
      combat.timer = ROUND_TIME;
      combat._timerAccumulator = 0;
      combat.roundActive = true;
    }
  }

  // 7. Return cloned state snapshot (immutable — caller keeps past states for rollback)
  const state = captureGameState(frame, p1, p2, combat);

  return { state, roundEvent };
}
