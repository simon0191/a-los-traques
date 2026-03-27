/**
 * State snapshot/restore for rollback netcode.
 * Re-exports from SimulationEngine (single source of truth).
 */
export {
  captureCombatState,
  captureFighterState,
  captureGameState,
  hashGameState,
  restoreCombatState,
  restoreFighterState,
  restoreGameState,
  SNAPSHOT_VERSION,
} from '../simulation/SimulationEngine.js';
