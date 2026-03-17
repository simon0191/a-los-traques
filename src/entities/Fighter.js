import Phaser from 'phaser';
import { GROUND_Y, GRAVITY, STAGE_LEFT, STAGE_RIGHT, MAX_HP, MAX_SPECIAL } from '../config.js';

export class Fighter {
  constructor(scene, x, y, textureKey, fighterData, playerIndex) {
    this.scene = scene;
    this.data = fighterData;
    this.playerIndex = playerIndex; // 0 or 1

    // Create sprite
    this.sprite = scene.physics.add.sprite(x, y, textureKey);
    this.sprite.setOrigin(0.5, 1); // Bottom center origin
    this.sprite.body.setGravityY(GRAVITY);

    // Check if this fighter has real sprite animations
    this.fighterId = fighterData.id;
    this.hasAnims = scene.anims.exists(`${this.fighterId}_idle`);
    if (this.hasAnims) {
      this.sprite.play(`${this.fighterId}_idle`);
    }

    // State
    this.hp = MAX_HP;
    this.special = 0;
    this.state = 'idle'; // idle, walking, jumping, attacking, hurt, knockdown, blocking, victory, defeat
    this._prevAnimState = null;
    this.facingRight = playerIndex === 0;
    this.attackCooldown = 0;
    this.hurtTimer = 0;
    this.isOnGround = true;
    this.hitConnected = false; // Set true by CombatSystem when attack lands

    // Double jump tracking
    this.hasDoubleJumped = false;
    this._airborneTime = 0; // ms since leaving ground
  }

  update(time, delta) {
    // Update cooldowns
    if (this.attackCooldown > 0) this.attackCooldown -= delta;
    if (this.hurtTimer > 0) {
      this.hurtTimer -= delta;
      if (this.hurtTimer <= 0) this.state = 'idle';
    }

    // Ground check
    const wasAirborne = !this.isOnGround;
    this.isOnGround = this.sprite.body.blocked.down || this.sprite.y >= GROUND_Y;
    if (this.isOnGround && wasAirborne) {
      this.hasDoubleJumped = false;
      this._airborneTime = 0;
    }
    if (!this.isOnGround) {
      this._airborneTime += delta;
    }

    // Clamp to stage bounds
    this.sprite.x = Phaser.Math.Clamp(this.sprite.x, STAGE_LEFT, STAGE_RIGHT);

    // Floor collision
    if (this.sprite.y > GROUND_Y) {
      this.sprite.y = GROUND_Y;
      this.sprite.body.setVelocityY(0);
    }

    // Update animation based on state
    if (this.hasAnims) {
      this._updateAnimation();
    }
  }

  _updateAnimation() {
    // Map state to animation key
    let animState = this.state;
    if (animState === 'attacking' && this.currentAttack) {
      // Map attack types to animation names
      const attackMap = {
        lightPunch: 'light_punch',
        heavyPunch: 'heavy_punch',
        lightKick: 'light_kick',
        heavyKick: 'heavy_kick',
        special: 'special',
      };
      animState = attackMap[this.currentAttack.type] || 'idle';
    } else if (animState === 'walking') {
      animState = 'walk';
    } else if (animState === 'jumping') {
      animState = 'jump';
    } else if (animState === 'blocking') {
      animState = 'block';
    }

    if (animState !== this._prevAnimState) {
      const key = `${this.fighterId}_${animState}`;
      if (this.scene.anims.exists(key)) {
        this.sprite.play(key);
        this._prevAnimState = animState;
      }
    }
  }

  faceOpponent(opponent) {
    this.facingRight = this.sprite.x < opponent.sprite.x;
    this.sprite.setFlipX(this.facingRight);
  }

  moveLeft(speed) {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking') this.sprite.clearTint();
    this.sprite.body.setVelocityX(-speed);
    this.state = 'walking';
  }

  moveRight(speed) {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking') this.sprite.clearTint();
    this.sprite.body.setVelocityX(speed);
    this.state = 'walking';
  }

  stop() {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking') this.sprite.clearTint();
    this.sprite.body.setVelocityX(0);
    if (this.isOnGround) this.state = 'idle';
  }

  jump() {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;

    if (this.isOnGround) {
      // Normal jump
      this.sprite.body.setVelocityY(-350);
      this.state = 'jumping';
      this.isOnGround = false;
      this.scene.game.audioManager.play('jump');
    } else if (!this.hasDoubleJumped && this._airborneTime > 100) {
      // Double jump: reset Y velocity and boost upward
      this.hasDoubleJumped = true;
      this.sprite.body.setVelocityY(-380);
      this.scene.game.audioManager.play('jump');
    }
  }

  attack(type) {
    // type: 'lightPunch', 'heavyPunch', 'lightKick', 'heavyKick', 'special'
    if (this.attackCooldown > 0 || this.state === 'hurt' || this.state === 'knockdown') return false;
    if (type === 'special' && this.special < 50) return false;

    const moveData = this.data.moves[type];
    if (!moveData) return false;

    this.state = 'attacking';
    this._prevAnimState = null;
    this.hitConnected = false;
    this.currentAttack = { type, ...moveData };

    // Total attack duration in ms (frames at 60fps)
    const totalFrames = moveData.startup + moveData.active + moveData.recovery;
    this.attackCooldown = (totalFrames / 60) * 1000;

    if (type === 'special') {
      this.special -= 50;
      this.scene.game.audioManager.play('special_charge');
      // Yellow glow for special attacks
      this.sprite.setTint(0xffcc00);
      this.scene.time.delayedCall(Math.min(this.attackCooldown, 400), () => {
        if (this.sprite && this.sprite.clearTint) this.sprite.clearTint();
      });
    }

    // Return to idle after attack
    this.scene.time.delayedCall(this.attackCooldown, () => {
      if (this.state === 'attacking') {
        if (!this.hitConnected) {
          this.scene.game.audioManager.play('whiff');
        }
        this.state = 'idle';
      }
      this.currentAttack = null;
    });

    return true;
  }

  // Returns the hitbox rect for the current attack (if in active frames)
  getAttackHitbox() {
    if (this.state !== 'attacking' || !this.currentAttack) return null;

    const reach = this.currentAttack.type.includes('Kick') ? 55 : 45;
    const dir = this.facingRight ? 1 : -1;

    return new Phaser.Geom.Rectangle(
      this.sprite.x + (dir * 10),
      this.sprite.y - 50,
      reach * dir,
      40
    );
  }

  getHurtbox() {
    return new Phaser.Geom.Rectangle(
      this.sprite.x - 18,
      this.sprite.y - 60,
      36,
      60
    );
  }

  takeDamage(amount, attackerX) {
    if (this.state === 'blocking') {
      amount = Math.floor(amount * 0.2); // Block reduces damage to 20%
      this.sprite.clearTint(); // Clear block tint
    }

    this.hp = Math.max(0, this.hp - amount);
    this.special = Math.min(100, this.special + amount * 0.8); // Gain special from taking damage

    // Knockback
    const knockDir = this.sprite.x > attackerX ? 1 : -1;
    this.sprite.body.setVelocityX(knockDir * 150);

    if (amount >= 15) {
      this.state = 'knockdown';
      this.hurtTimer = 800;
      this.sprite.body.setVelocityY(-200);
    } else {
      this.state = 'hurt';
      this.hurtTimer = 300;
    }

    return this.hp <= 0;
  }

  block() {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    this.state = 'blocking';
    this.sprite.body.setVelocityX(0);
    // Blue tint while blocking
    this.sprite.setTint(0x6688ff);
  }

  reset(x) {
    this.sprite.setPosition(x, GROUND_Y);
    this.sprite.body.setVelocity(0, 0);
    this.sprite.clearTint();
    this.hp = MAX_HP;
    this.special = 0;
    this.state = 'idle';
    this._prevAnimState = null;
    this.attackCooldown = 0;
    this.hurtTimer = 0;
    this.currentAttack = null;
    this.hitConnected = false;
    this.hasDoubleJumped = false;
    this._airborneTime = 0;
    if (this.hasAnims) {
      this.sprite.play(`${this.fighterId}_idle`);
    }
  }

  get alive() {
    return this.hp > 0;
  }
}
