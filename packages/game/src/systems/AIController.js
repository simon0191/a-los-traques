import { FP_SCALE } from '@alostraques/sim';
import { MAX_HP, SPECIAL_COST } from '../config.js';

/**
 * Mulberry32 seeded PRNG — returns a function that produces [0,1) floats.
 * Same seed always produces the same sequence.
 */
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * AI Controller for P2 fighter with three difficulty levels.
 *
 * Usage:
 *   const ai = new AIController(scene, p2Fighter, p1Fighter, 'medium');
 *   // in update():
 *   ai.update(time, delta);
 *   ai.applyDecisions();
 */
export class AIController {
  /**
   * @param {Phaser.Scene} scene
   * @param {Fighter} fighter   - the AI-controlled fighter
   * @param {Fighter} opponent  - the human (or other) fighter
   * @param {'easy'|'medium'|'hard'} difficulty
   */
  constructor(scene, fighter, opponent, difficulty = 'medium') {
    this.scene = scene;
    this.fighter = fighter;
    this.opponent = opponent;
    this.difficulty = difficulty;
    this.frameCounter = 0;

    this.config = this.getDifficultyConfig(difficulty);
    this._rng = Math.random;

    /** Current decision output – read by applyDecisions() every frame. */
    this.decision = {
      moveDir: 0, // -1 left, 0 stop, 1 right
      jump: false,
      attack: null, // null | attack type string
      block: false,
    };
  }

  /**
   * Set a deterministic PRNG seed. Once set, all AI decisions become reproducible.
   */
  setSeed(seed) {
    this._rng = mulberry32(seed);
  }

  // ---------------------------------------------------------------------------
  // Difficulty presets
  // ---------------------------------------------------------------------------

  getDifficultyConfig(difficulty) {
    const configMap = {
      1: 'easy',
      2: 'easy_plus',
      3: 'medium',
      4: 'hard',
      5: 'hard_plus',
      easy: 'easy',
      medium: 'medium',
      hard: 'hard',
    };

    const mode = configMap[difficulty] || 'medium';

    switch (mode) {
      case 'easy':
        return {
          thinkInterval: 40,
          missRate: 0.5,
          canBlock: false,
          canSpecial: false,
          jumpChance: 0.1,
          backOffChance: 0.1,
          blockChance: 0,
          idealRange: 60,
          approachRange: 80,
          tooCloseRange: 20,
          punishRecovery: false,
          readOpponentState: false,
          reactionJump: false,
          specialChance: 0,
          attackWeights: [0.4, 0.7, 0.85], // lightP, lightK, heavyP (rest is heavyK)
          wallJumpChance: 0,
        };
      case 'easy_plus':
        return {
          thinkInterval: 30,
          missRate: 0.35,
          canBlock: true,
          canSpecial: false,
          jumpChance: 0.1,
          backOffChance: 0.15,
          blockChance: 0.2,
          idealRange: 55,
          approachRange: 75,
          tooCloseRange: 25,
          punishRecovery: false,
          readOpponentState: false,
          reactionJump: false,
          specialChance: 0,
          attackWeights: [0.35, 0.65, 0.8],
          wallJumpChance: 0.1,
        };
      case 'medium':
        return {
          thinkInterval: 15,
          missRate: 0.2,
          canBlock: true,
          canSpecial: true,
          jumpChance: 0.08,
          backOffChance: 0.25,
          blockChance: 0.45,
          idealRange: 50,
          approachRange: 65,
          tooCloseRange: 35,
          punishRecovery: false,
          readOpponentState: true,
          reactionJump: false,
          specialChance: 0.4,
          attackWeights: [0.3, 0.5, 0.7],
          wallJumpChance: 0.3,
        };
      case 'hard':
        return {
          thinkInterval: 8,
          missRate: 0.1,
          canBlock: true,
          canSpecial: true,
          jumpChance: 0.05,
          backOffChance: 0.35,
          blockChance: 0.7,
          idealRange: 52,
          approachRange: 65,
          tooCloseRange: 30,
          punishRecovery: true,
          readOpponentState: true,
          reactionJump: true,
          specialChance: 0.65,
          attackWeights: [0.35, 0.55, 0.75],
          wallJumpChance: 1.0,
        };
      case 'hard_plus':
        return {
          thinkInterval: 4,
          missRate: 0.02,
          canBlock: true,
          canSpecial: true,
          jumpChance: 0.05,
          backOffChance: 0.4,
          blockChance: 0.85,
          idealRange: 52,
          approachRange: 60,
          tooCloseRange: 35,
          punishRecovery: true,
          readOpponentState: true,
          reactionJump: true,
          specialChance: 0.85,
          attackWeights: [0.4, 0.6, 0.8],
          wallJumpChance: 1.0,
        };
      default:
        return this.getDifficultyConfig('medium');
    }
  }

  // ---------------------------------------------------------------------------
  // Frame-level update (called every frame by FightScene)
  // ---------------------------------------------------------------------------

  update(_time, _delta) {
    this.frameCounter++;
    if (this.frameCounter >= this.config.thinkInterval) {
      this.frameCounter = 0;
      this.think();
    }
  }

  // ---------------------------------------------------------------------------
  // Main decision-making routine
  // ---------------------------------------------------------------------------

  think() {
    const cfg = this.config;
    const me = this.fighter;
    const opp = this.opponent;

    // Reset
    this.decision.moveDir = 0;
    this.decision.jump = false;
    this.decision.attack = null;
    this.decision.block = false;

    // If we are in an uncontrollable state, do nothing
    if (me.state === 'hurt' || me.state === 'knockdown') return;

    // Low stamina: back off and don't attack to let it regenerate
    if (me.stamina < 20) {
      const dx2 = me.simX / FP_SCALE - opp.simX / FP_SCALE;
      this.decision.moveDir = dx2 > 0 ? 1 : -1; // walk away
      return;
    }

    // --- Spatial awareness ---
    const dx = me.simX / FP_SCALE - opp.simX / FP_SCALE; // positive = AI is to the right
    const absDist = Math.abs(dx);
    const dirToOpponent = dx > 0 ? -1 : 1; // direction toward opponent

    const oppAttacking = opp.state === 'attacking';
    const oppRecovering = opp.state === 'hurt' || opp.state === 'knockdown';
    const oppJumping = opp.state === 'jumping';
    const lowHp = me.hp < MAX_HP * 0.35;

    // ------------------------------------------------------------------
    // 1. Defensive: react to opponent attacking while close
    // ------------------------------------------------------------------
    if (oppAttacking && absDist < cfg.approachRange) {
      if (cfg.canBlock && this._rng() < cfg.blockChance) {
        this.decision.block = true;
        return; // blocking is exclusive
      }
      // Otherwise try to back off
      if (this._rng() < 0.4) {
        this.decision.moveDir = -dirToOpponent; // walk away
        return;
      }
    }

    // ------------------------------------------------------------------
    // 2. Punish opponent recovery (hard mode)
    // ------------------------------------------------------------------
    if (cfg.punishRecovery && oppRecovering && absDist < cfg.approachRange) {
      if (this._rng() > cfg.missRate) {
        this.decision.attack = 'heavyPunch';
        // Walk in if not quite in range
        if (absDist > cfg.idealRange) {
          this.decision.moveDir = dirToOpponent;
        }
        return;
      }
    }

    // ------------------------------------------------------------------
    // 3. Blocking when low HP (medium can do this sometimes)
    // ------------------------------------------------------------------
    if (
      cfg.canBlock &&
      lowHp &&
      absDist < cfg.approachRange &&
      this._rng() < cfg.blockChance * 0.5
    ) {
      this.decision.block = true;
      return;
    }

    // ------------------------------------------------------------------
    // 4. Attack if at ideal range
    // ------------------------------------------------------------------
    if (absDist <= cfg.approachRange && absDist >= cfg.tooCloseRange) {
      if (this._rng() > cfg.missRate) {
        this.decision.attack = this._pickAttack(absDist);
      }
    }

    // ------------------------------------------------------------------
    // 5. Too close – back off occasionally
    // ------------------------------------------------------------------
    if (absDist < cfg.tooCloseRange) {
      if (this._rng() < cfg.backOffChance) {
        this.decision.moveDir = -dirToOpponent;
      } else if (this._rng() > cfg.missRate) {
        // Quick jab when very close
        this.decision.attack = 'lightPunch';
      }
    }

    // ------------------------------------------------------------------
    // 6. Too far – approach
    // ------------------------------------------------------------------
    if (absDist > cfg.approachRange) {
      this.decision.moveDir = dirToOpponent;
    }

    // ------------------------------------------------------------------
    // 7. Jumping (mix-up / evasion)
    // ------------------------------------------------------------------
    if (this._rng() < cfg.jumpChance) {
      if (cfg.reactionJump) {
        if (oppJumping || (oppAttacking && absDist < cfg.approachRange)) {
          this.decision.jump = true;
        }
      } else {
        this.decision.jump = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pick an attack type based on range and meter
  // ---------------------------------------------------------------------------

  _pickAttack(absDist) {
    const cfg = this.config;
    const me = this.fighter;

    // Special attack when meter is full and in range
    if (cfg.canSpecial && me.special >= SPECIAL_COST && absDist < cfg.idealRange + 10) {
      if (this._rng() < cfg.specialChance) {
        return 'special';
      }
    }

    // Weighted random pick – favour lights for speed, heavies for damage
    const roll = this._rng();
    const w = cfg.attackWeights;

    if (roll < w[0]) return 'lightPunch';
    if (roll < w[1]) return 'lightKick';
    if (roll < w[2]) return 'heavyPunch';
    return 'heavyKick';
  }

  // ---------------------------------------------------------------------------
  // Apply the current decision to the fighter (called every frame)
  // ---------------------------------------------------------------------------

  applyDecisions(events) {
    const fighter = this.fighter;
    const speed = (80 + fighter.data.stats.speed * 20) * FP_SCALE;

    // Blocking is exclusive – no movement or attacks while holding block
    if (this.decision.block && fighter.isOnGround) {
      fighter.block();
      return;
    }

    // Movement
    if (this.decision.moveDir < 0) {
      fighter.moveLeft(speed);
    } else if (this.decision.moveDir > 0) {
      fighter.moveRight(speed);
    } else {
      fighter.stop();
    }

    // Jump (consume immediately so we don't re-jump every frame)
    if (this.decision.jump && fighter.isOnGround) {
      fighter.jump(events);
      this.decision.jump = false;
    }

    // Wall jump
    if (fighter._isTouchingWall && !fighter._hasWallJumped) {
      if (this._rng() < this.config.wallJumpChance) {
        fighter.jump(events);
      }
    }

    // Attack (consume immediately)
    if (this.decision.attack) {
      fighter.attack(this.decision.attack, events);
      this.decision.attack = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy() {
    // Nothing to dispose – no timers or events owned by this class.
    this.scene = null;
    this.fighter = null;
    this.opponent = null;
  }
}
