/**
 * Neural AI Controller — ONNX-based RL agent for El Cerebro (RFC 0020 §9).
 *
 * Drop-in replacement for AIController. Same interface:
 *   - constructor(scene, fighter, opponent, difficulty)
 *   - update(time, delta) → sets this.decision
 *   - decision: { moveDir, jump, attack, block }
 *   - setSeed(n) → seeds the ε-greedy PRNG
 *   - destroy()
 *
 * Loads an ONNX model via onnxruntime-web (WASM backend) and runs
 * inference to produce actions. Falls back to idle if model isn't loaded.
 */

import {
  FP_SCALE,
  GROUND_Y,
  MAX_HP,
  MAX_SPECIAL_FP,
  MAX_STAMINA_FP,
  ROUND_TIME,
  STAGE_LEFT,
  STAGE_RIGHT,
} from '@alostraques/sim';

const OBS_DIM = 47;
const NUM_ACTIONS = 72;
const STAGE_WIDTH = STAGE_RIGHT - STAGE_LEFT;
const MAX_COOLDOWN = 22;
const MAX_COMBO = 10;
const MAX_BLOCKSTUN = 12;

const STATE_MAP = {
  idle: 0,
  walking: 1,
  jumping: 2,
  attacking: 3,
  hurt: 4,
  knockdown: 5,
  blocking: 6,
};
const NUM_STATES = 7;

// Movement + attack mappings matching action-table.js
const MOVEMENTS = [-1, 0, 1];
const ATTACKS = [null, 'lightPunch', 'heavyPunch', 'lightKick', 'heavyKick', 'special'];

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class NeuralAIController {
  /**
   * @param {Phaser.Scene|null} scene
   * @param {Fighter|FighterSim} fighter  - the AI-controlled fighter
   * @param {Fighter|FighterSim} opponent - the human fighter
   * @param {'easy'|'easy_plus'|'medium'|'hard'|'hard_plus'} difficulty
   */
  constructor(scene, fighter, opponent, difficulty = 'hard_plus') {
    this.scene = scene;
    this.fighter = fighter;
    this.opponent = opponent;
    this.difficulty = difficulty;
    this.frameCounter = 0;
    this.decisionInterval = 4;

    this.decision = {
      moveDir: 0,
      jump: false,
      attack: null,
      block: false,
    };

    // ONNX session — set externally via setSession() after async load
    this._session = null;
    this._ort = null;
    this._rng = mulberry32(42);
    this._epsilon = 0;
    this._obs = new Float32Array(OBS_DIM);
  }

  /** Set the ONNX runtime session after async loading. */
  setSession(ort, session) {
    this._ort = ort;
    this._session = session;
  }

  /** Seed the PRNG for deterministic ε-greedy in replays. */
  setSeed(n) {
    this._rng = mulberry32(n);
  }

  update(time, delta) {
    this.frameCounter++;
    if (this.frameCounter % this.decisionInterval !== 0) return;

    if (!this._session || !this._ort) return; // Model not loaded yet

    // Extract observation
    this._extractObs();

    // Run inference (sync via runSync if available, else skip)
    let actionIdx;
    try {
      const inputTensor = new this._ort.Tensor('float32', this._obs, [1, OBS_DIM]);
      const inputName = this._session.inputNames[0];
      const results = this._session.run({ [inputName]: inputTensor });

      // Handle both sync and async results
      if (results instanceof Promise) {
        // Can't await in update() — use last decision
        results.then((r) => this._applyResults(r));
        return;
      }
      actionIdx = this._pickAction(results);
    } catch {
      return; // Inference failed — keep last decision
    }

    this._decodeAction(actionIdx);
  }

  _applyResults(results) {
    const actionIdx = this._pickAction(results);
    this._decodeAction(actionIdx);
  }

  _pickAction(results) {
    const qValues = results[this._session.outputNames[0]].data;

    // ε-greedy
    if (this._rng() < this._epsilon) {
      return Math.floor(this._rng() * NUM_ACTIONS);
    }

    // Argmax
    let bestIdx = 0;
    let bestQ = qValues[0];
    for (let i = 1; i < NUM_ACTIONS; i++) {
      if (qValues[i] > bestQ) {
        bestQ = qValues[i];
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  _decodeAction(actionIdx) {
    const moveIdx = Math.floor(actionIdx / 24);
    const remainder = actionIdx % 24;
    const jumpIdx = Math.floor(remainder / 12);
    const remainder2 = remainder % 12;
    const blockIdx = Math.floor(remainder2 / 6);
    const atkIdx = remainder2 % 6;

    this.decision.moveDir = MOVEMENTS[moveIdx] ?? 0;
    this.decision.jump = jumpIdx === 1;
    this.decision.block = blockIdx === 1;
    this.decision.attack = ATTACKS[atkIdx] ?? null;
  }

  _extractObs() {
    const obs = this._obs;
    let idx = 0;

    const me = this.fighter.sim ?? this.fighter;
    const opp = this.opponent.sim ?? this.opponent;

    const writeFighter = (f) => {
      obs[idx++] = f.simX / FP_SCALE / STAGE_RIGHT;
      obs[idx++] = f.simY / FP_SCALE / GROUND_Y;
      const maxVel = 350;
      obs[idx++] = Math.max(-1, Math.min(1, f.simVX / FP_SCALE / maxVel));
      obs[idx++] = Math.max(-1, Math.min(1, f.simVY / FP_SCALE / maxVel));
      obs[idx++] = f.hp / MAX_HP;
      obs[idx++] = f.stamina / MAX_STAMINA_FP;
      obs[idx++] = f.special / MAX_SPECIAL_FP;
      const si = STATE_MAP[f.state] ?? 0;
      for (let j = 0; j < NUM_STATES; j++) obs[idx++] = j === si ? 1 : 0;
      obs[idx++] = f.attackCooldown / MAX_COOLDOWN;
      obs[idx++] = (f.attackFrameElapsed ?? 0) / MAX_COOLDOWN;
      obs[idx++] =
        f.currentAttack &&
        f.attackFrameElapsed >= (f.currentAttack.startup ?? 0) &&
        f.attackFrameElapsed < (f.currentAttack.startup ?? 0) + (f.currentAttack.active ?? 0)
          ? 1
          : 0;
      obs[idx++] = (f.comboCount ?? 0) / MAX_COMBO;
      obs[idx++] = (f.blockTimer ?? 0) / MAX_BLOCKSTUN;
      obs[idx++] = f.isOnGround ? 1 : 0;
      obs[idx++] = f.facingRight ? 1 : 0;
      obs[idx++] = f.hasDoubleJumped ? 1 : 0;
      obs[idx++] = f._isTouchingWall ? 1 : 0;
    };

    writeFighter(me);
    writeFighter(opp);

    // Context (3)
    const combat = this.scene?.combat?.sim;
    obs[idx++] = (combat?.timer ?? ROUND_TIME) / ROUND_TIME;
    const dist = Math.abs(me.simX - opp.simX) / FP_SCALE;
    obs[idx++] = dist / STAGE_WIDTH;
    const mePx = me.simX / FP_SCALE;
    const distToWall = Math.min(mePx - STAGE_LEFT, STAGE_RIGHT - mePx);
    obs[idx++] = distToWall / (STAGE_WIDTH / 2);
  }

  destroy() {
    this._session = null;
    this._ort = null;
    this.fighter = null;
    this.opponent = null;
    this.scene = null;
  }
}
