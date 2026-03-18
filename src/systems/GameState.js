/**
 * State snapshot/restore for rollback netcode.
 * Captures all mutable game state into plain JS objects.
 */

/**
 * Capture a fighter's mutable state into a plain object.
 * @param {import('../entities/Fighter.js').Fighter} fighter
 * @returns {object}
 */
export function captureFighterState(fighter) {
  return {
    x: fighter.sprite.x,
    y: fighter.sprite.y,
    vx: fighter.sprite.body.velocity.x,
    vy: fighter.sprite.body.velocity.y,
    hp: fighter.hp,
    special: fighter.special,
    stamina: fighter.stamina,
    state: fighter.state,
    attackCooldown: fighter.attackCooldown,
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
  fighter.sprite.x = state.x;
  fighter.sprite.y = state.y;
  fighter.sprite.body.velocity.x = state.vx;
  fighter.sprite.body.velocity.y = state.vy;
  fighter.hp = state.hp;
  fighter.special = state.special;
  fighter.stamina = state.stamina;
  fighter.state = state.state;
  fighter.attackCooldown = state.attackCooldown;
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
}

/**
 * Capture full game state snapshot.
 * @param {number} frame
 * @param {import('../entities/Fighter.js').Fighter} p1
 * @param {import('../entities/Fighter.js').Fighter} p2
 * @param {import('./CombatSystem.js').CombatSystem} combat
 * @returns {object}
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
 * @param {object} snapshot
 * @param {import('../entities/Fighter.js').Fighter} p1
 * @param {import('../entities/Fighter.js').Fighter} p2
 * @param {import('./CombatSystem.js').CombatSystem} combat
 */
export function restoreGameState(snapshot, p1, p2, combat) {
  restoreFighterState(p1, snapshot.p1);
  restoreFighterState(p2, snapshot.p2);
  restoreCombatState(combat, snapshot.combat);
}
