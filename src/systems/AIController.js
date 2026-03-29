import { MAX_HP, SPECIAL_COST } from '../config.js';
import { FP_SCALE } from './FixedPoint.js';

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
    switch (difficulty) {
      case 'easy':
        return {
          thinkInterval: 30, // ~500 ms at 60 fps
          missRate: 0.4, // 40 % chance to skip an attack opportunity
          canBlock: false,
          canSpecial: false,
          jumpChance: 0.1, // random jumps
          backOffChance: 0.15,
          blockChance: 0, // never blocks
          idealRange: 55,
          approachRange: 70,
          tooCloseRange: 25,
          punishRecovery: false,
          readOpponentState: false,
        };

      case 'hard':
        return {
          thinkInterval: 5, // ~83 ms at 60 fps
          missRate: 0.05,
          canBlock: true,
          canSpecial: true,
          jumpChance: 0.06, // tactical jumps only
          backOffChance: 0.35,
          blockChance: 0.7, // actively blocks when opponent attacks
          idealRange: 52,
          approachRange: 65,
          tooCloseRange: 30,
          punishRecovery: true,
          readOpponentState: true,
        };
      default:
        return {
          thinkInterval: 15, // ~250 ms at 60 fps
          missRate: 0.2,
          canBlock: true,
          canSpecial: true,
          jumpChance: 0.08,
          backOffChance: 0.25,
          blockChance: 0.35,
          idealRange: 55,
          approachRange: 68,
          tooCloseRange: 28,
          punishRecovery: false,
          readOpponentState: false,
        };
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
      // Hard mode: jump to dodge or when opponent jumps
      if (this.difficulty === 'hard') {
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
      // Hard: always use when available and close. Medium: 40 % chance.
      const specialChance = this.difficulty === 'hard' ? 0.65 : 0.4;
      if (this._rng() < specialChance) {
        return 'special';
      }
    }

    // Weighted random pick – favour lights for speed, heavies for damage
    const roll = this._rng();

    if (this.difficulty === 'hard') {
      // Hard prefers fast attacks, uses heavies to punish
      if (roll < 0.35) return 'lightPunch';
      if (roll < 0.55) return 'lightKick';
      if (roll < 0.75) return 'heavyPunch';
      return 'heavyKick';
    }

    if (this.difficulty === 'medium') {
      if (roll < 0.3) return 'lightPunch';
      if (roll < 0.5) return 'lightKick';
      if (roll < 0.7) return 'heavyPunch';
      return 'heavyKick';
    }

    // Easy – mostly lights
    if (roll < 0.4) return 'lightPunch';
    if (roll < 0.7) return 'lightKick';
    if (roll < 0.85) return 'heavyPunch';
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

    // Wall jump: hard always, medium 30% chance
    if (fighter._isTouchingWall && !fighter._hasWallJumped) {
      const wallJumpChance =
        this.difficulty === 'hard' ? 1.0 : this.difficulty === 'medium' ? 0.3 : 0;
      if (this._rng() < wallJumpChance) {
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
