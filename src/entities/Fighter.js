import { FighterSim } from '../simulation/FighterSim.js';
import { FP_SCALE } from '../systems/FixedPoint.js';

export { calculateBlockDamage } from './combat-block.js';

/**
 * All FighterSim state fields proxied to Fighter via getters/setters.
 * Existing code reads/writes fighter.simX and it transparently goes to fighter.sim.simX.
 */
const SIM_FIELDS = [
  'simX',
  'simY',
  'simVX',
  'simVY',
  'hp',
  'special',
  'stamina',
  'state',
  'facingRight',
  'attackCooldown',
  'attackFrameElapsed',
  'currentAttack',
  'hitConnected',
  'comboCount',
  '_specialTintTimer',
  'blockTimer',
  'hurtTimer',
  'isOnGround',
  'hasDoubleJumped',
  '_airborneTime',
  '_isTouchingWall',
  '_wallDir',
  '_hasWallJumped',
  '_prevAnimState',
];

export class Fighter {
  constructor(scene, x, y, textureKey, fighterData, playerIndex) {
    this.scene = scene;
    this.playerIndex = playerIndex;
    this.data = fighterData;

    // Pure simulation state — canonical source of truth
    this.sim = new FighterSim(x, playerIndex, fighterData);

    // Proxy all simulation fields so existing code (GameState, SimulationStep, etc.) works
    for (const field of SIM_FIELDS) {
      Object.defineProperty(this, field, {
        get() {
          return this.sim[field];
        },
        set(v) {
          this.sim[field] = v;
        },
        enumerable: true,
        configurable: true,
      });
    }

    // FighterSim starts at GROUND_Y, but Fighter gets an explicit y from the scene
    this.sim.simY = Math.trunc(y * FP_SCALE);

    // Phaser sprite
    this.sprite = scene.physics.add.sprite(x, y, textureKey);
    this.sprite.setOrigin(0.5, 1);
    this.sprite.body.moves = false;
    this.sprite.body.setAllowGravity(false);

    // Animation detection
    this.fighterId = fighterData.id;
    const idleTexKey = `fighter_${this.fighterId}_idle`;
    const idleTex = scene.textures.exists(idleTexKey) && scene.textures.get(idleTexKey);
    this.hasAnims = idleTex && idleTex.frameTotal > 2;
    if (this.hasAnims) {
      this.sprite.play(`${this.fighterId}_idle`);
    }
  }

  // --- Simulation methods: delegate to FighterSim, then apply presentation side effects ---

  update() {
    // Snapshot state before sim for detecting whiff/tint changes
    const wasAttacking = this.sim.state === 'attacking';
    const hadHitConnected = this.sim.hitConnected;
    const prevTintTimer = this.sim._specialTintTimer;

    this.sim.update();

    // Presentation: whiff sound on attack completion without hit
    if (wasAttacking && this.sim.state === 'idle' && !hadHitConnected) {
      if (!this.scene._muteEffects) {
        this.scene.game.audioManager.play('whiff');
      }
    }

    // Presentation: clear tint when special tint timer expires
    if (prevTintTimer > 0 && this.sim._specialTintTimer <= 0) {
      if (this.sprite?.clearTint) this.sprite.clearTint();
    }

    // Update animation
    if (this.hasAnims) {
      this._updateAnimation();
    }
  }

  moveLeft(speed) {
    const wasBlocking = this.sim.state === 'blocking';
    this.sim.moveLeft(speed);
    if (wasBlocking && this.sim.state === 'walking') this.sprite.clearTint();
  }

  moveRight(speed) {
    const wasBlocking = this.sim.state === 'blocking';
    this.sim.moveRight(speed);
    if (wasBlocking && this.sim.state === 'walking') this.sprite.clearTint();
  }

  stop() {
    const wasBlocking = this.sim.state === 'blocking';
    this.sim.stop();
    if (wasBlocking && this.sim.state !== 'blocking') this.sprite.clearTint();
  }

  jump() {
    const wasOnGround = this.sim.isOnGround;
    const prevVY = this.sim.simVY;
    this.sim.jump();
    // Detect if a jump actually happened (velocity changed)
    if (this.sim.simVY !== prevVY || (!this.sim.isOnGround && wasOnGround)) {
      if (!this.scene._muteEffects) this.scene.game.audioManager.play('jump');
    }
  }

  block() {
    this.sim.block();
    this.sprite.setTint(0x6688ff);
  }

  attack(type) {
    const result = this.sim.attack(type);
    if (result && type === 'special') {
      if (!this.scene._muteEffects) {
        this.scene.game.audioManager.play('special_charge');
      }
      if (!this.scene._muteEffects) {
        this.sprite.setTint(0xffcc00);
      }
    }
    return result;
  }

  faceOpponent(opponent) {
    // Accept either a Fighter (with .sim) or a FighterSim (with .simX directly)
    const opponentSim = opponent.sim || opponent;
    this.sim.faceOpponent(opponentSim);
    this.sprite.setFlipX(!this.sim.facingRight);
  }

  getAttackHitbox() {
    return this.sim.getAttackHitbox();
  }

  getHurtbox() {
    return this.sim.getHurtbox();
  }

  takeDamage(amount, attackerSimX, stunFrames) {
    if (this.sim.state === 'blocking') {
      this.sprite.clearTint();
    }
    return this.sim.takeDamage(amount, attackerSimX, stunFrames);
  }

  // --- Presentation-only methods ---

  _updateAnimation() {
    let animState = this.sim.state;
    if (animState === 'attacking' && this.sim.currentAttack) {
      const attackMap = {
        lightPunch: 'light_punch',
        heavyPunch: 'heavy_punch',
        lightKick: 'light_kick',
        heavyKick: 'heavy_kick',
        special: 'special',
      };
      animState = attackMap[this.sim.currentAttack.type] || 'idle';
    } else if (animState === 'walking') {
      animState = 'walk';
    } else if (animState === 'jumping') {
      animState = 'jump';
    } else if (animState === 'blocking') {
      animState = 'block';
    }

    if (animState !== this.sim._prevAnimState) {
      const key = `${this.fighterId}_${animState}`;
      if (this.scene.anims.exists(key)) {
        if (
          this.sim.state === 'attacking' &&
          this.sim.currentAttack &&
          this.sim.attackCooldown > 0
        ) {
          const anim = this.scene.anims.get(key);
          const fps = (anim.frames.length / this.sim.attackCooldown) * 60;
          this.sprite.play({ key, frameRate: fps });
        } else {
          this.sprite.play(key);
        }
        this.sim._prevAnimState = animState;
      }
    }
  }

  updateAnimation() {
    if (this.hasAnims) this._updateAnimation();
  }

  syncSprite() {
    this.sprite.x = this.sim.simX / FP_SCALE;
    this.sprite.y = this.sim.simY / FP_SCALE;
    this.sprite.setFlipX(!this.sim.facingRight);
  }

  reset(x) {
    this.sim.resetForRound(x);
    this.syncSprite();
    this.sprite.clearTint();
    if (this.hasAnims) {
      this.sprite.play(`${this.fighterId}_idle`);
    }
  }

  resetForRound(x) {
    this.sim.resetForRound(x);
  }

  get alive() {
    return this.sim.hp > 0;
  }
}
