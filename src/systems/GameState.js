/**
 * State snapshot/restore for rollback netcode.
 * Captures all mutable game state into plain JS objects.
 * Uses FP simulation fields (simX/simY/simVX/simVY) instead of sprite/body.
 */

/**
 * Capture a fighter's mutable state into a plain object.
 * @param {import('../entities/Fighter.js').Fighter} fighter
 * @returns {object}
 */
export function captureFighterState(fighter) {
  return {
    simX: fighter.simX,
    simY: fighter.simY,
    simVX: fighter.simVX,
    simVY: fighter.simVY,
    hp: fighter.hp,
    special: fighter.special,
    stamina: fighter.stamina,
    state: fighter.state,
    attackCooldown: fighter.attackCooldown,
    attackFrameElapsed: fighter.attackFrameElapsed || 0,
    comboCount: fighter.comboCount || 0,
    blockTimer: fighter.blockTimer || 0,
    hurtTimer: fighter.hurtTimer,
    hitConnected: fighter.hitConnected,
    currentAttack: fighter.currentAttack ? { ...fighter.currentAttack } : null,
    isOnGround: fighter.isOnGround,
    _airborneTime: fighter._airborneTime,
    hasDoubleJumped: fighter.hasDoubleJumped,
    facingRight: fighter.facingRight,
    _isTouchingWall: fighter._isTouchingWall,
    _wallDir: fighter._wallDir,
    _hasWallJumped: fighter._hasWallJumped,
    _prevAnimState: fighter._prevAnimState,
    _specialTintTimer: fighter._specialTintTimer || 0,
  };
}

/**
 * Restore a fighter's state from a snapshot.
 * @param {import('../entities/Fighter.js').Fighter} fighter
 * @param {object} state
 */
export function restoreFighterState(fighter, state) {
  fighter.simX = state.simX;
  fighter.simY = state.simY;
  fighter.simVX = state.simVX;
  fighter.simVY = state.simVY;
  fighter.hp = state.hp;
  fighter.special = state.special;
  fighter.stamina = state.stamina;
  fighter.state = state.state;
  fighter.attackCooldown = state.attackCooldown;
  fighter.attackFrameElapsed = state.attackFrameElapsed || 0;
  fighter.comboCount = state.comboCount || 0;
  fighter.blockTimer = state.blockTimer || 0;
  fighter.hurtTimer = state.hurtTimer;
  fighter.hitConnected = state.hitConnected;
  fighter.currentAttack = state.currentAttack ? { ...state.currentAttack } : null;
  fighter.isOnGround = state.isOnGround;
  fighter._airborneTime = state._airborneTime;
  fighter.hasDoubleJumped = state.hasDoubleJumped;
  fighter.facingRight = state.facingRight;
  fighter._isTouchingWall = state._isTouchingWall;
  fighter._wallDir = state._wallDir;
  fighter._hasWallJumped = state._hasWallJumped;
  fighter._prevAnimState = state._prevAnimState;
  fighter._specialTintTimer = state._specialTintTimer || 0;
  // Sync sprite after restoring simulation state
  if (fighter.syncSprite) fighter.syncSprite();
}

/**
 * Capture combat system state.
 * @param {import('./CombatSystem.js').CombatSystem} combat
 * @returns {object}
 */
export function captureCombatState(combat) {
  return {
    roundNumber: combat.roundNumber,
    p1RoundsWon: combat.p1RoundsWon,
    p2RoundsWon: combat.p2RoundsWon,
    timer: combat.timer,
    roundActive: combat.roundActive,
    matchOver: combat.matchOver,
    _timerAccumulator: combat._timerAccumulator || 0,
    transitionTimer: combat.transitionTimer || 0,
  };
}

/**
 * Restore combat system state from a snapshot.
 * @param {import('./CombatSystem.js').CombatSystem} combat
 * @param {object} state
 */
export function restoreCombatState(combat, state) {
  combat.roundNumber = state.roundNumber;
  combat.p1RoundsWon = state.p1RoundsWon;
  combat.p2RoundsWon = state.p2RoundsWon;
  combat.timer = state.timer;
  combat.roundActive = state.roundActive;
  combat.matchOver = state.matchOver;
  combat._timerAccumulator = state._timerAccumulator || 0;
  combat.transitionTimer = state.transitionTimer || 0;
}

/**
 * Capture full game state snapshot.
 */
export function captureGameState(frame, p1, p2, combat) {
  return {
    frame,
    p1: captureFighterState(p1),
    p2: captureFighterState(p2),
    combat: captureCombatState(combat),
  };
}

/**
 * Restore full game state from snapshot.
 */
export function restoreGameState(snapshot, p1, p2, combat) {
  restoreFighterState(p1, snapshot.p1);
  restoreFighterState(p2, snapshot.p2);
  restoreCombatState(combat, snapshot.combat);
}

/**
 * Compute a fast hash of a game state snapshot for desync detection.
 * XOR-rotate hash over key integer fields from both fighters + combat state.
 * @param {object} snapshot - result of captureGameState()
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
