import Phaser from 'phaser';
import { MAX_HP, MAX_SPECIAL, SPECIAL_COST, ROUND_TIME, ROUNDS_TO_WIN, GAME_WIDTH, GROUND_Y } from '../config.js';

export class CombatSystem {
  constructor(scene) {
    this.scene = scene;
    this.roundNumber = 1;
    this.p1RoundsWon = 0;
    this.p2RoundsWon = 0;
    this.timer = ROUND_TIME;
    this.roundActive = false;
    this.matchOver = false;
    this.timerEvent = null;
  }

  startRound() {
    this.timer = ROUND_TIME;
    this.roundActive = true;
    // Start timer countdown
    // In online mode, only the host counts down and triggers timeUp.
    // The guest's timer is overwritten by sync messages from the host.
    const isOnlineGuest = this.scene.gameMode === 'online' && !this.scene.isHost;
    this.timerEvent = this.scene.time.addEvent({
      delay: 1000,
      callback: () => {
        if (!isOnlineGuest) {
          this.timer--;
          if (this.timer <= 0) this.timeUp();
        }
      },
      loop: true
    });
  }

  stopRound() {
    this.roundActive = false;
    if (this.timerEvent) {
      this.timerEvent.remove();
      this.timerEvent = null;
    }
  }

  checkHit(attacker, defender) {
    if (!attacker.currentAttack || attacker.state !== 'attacking') return false;
    if (attacker.hitConnected) return false; // Already hit this attack

    const hitbox = attacker.getAttackHitbox();
    const hurtbox = defender.getHurtbox();
    if (!hitbox || !hurtbox) return false;

    // Normalize hitbox (width could be negative if facing left)
    const hx = hitbox.width < 0 ? hitbox.x + hitbox.width : hitbox.x;
    const hw = Math.abs(hitbox.width);
    const normalizedHitbox = new Phaser.Geom.Rectangle(hx, hitbox.y, hw, hitbox.height);

    if (Phaser.Geom.Rectangle.Overlaps(normalizedHitbox, hurtbox)) {
      this.applyDamage(attacker, defender);
      attacker.hitConnected = true;
      return true;
    }
    return false;
  }

  applyDamage(attacker, defender) {
    const move = attacker.currentAttack;
    let damage = move.damage;

    // Apply attacker's power stat modifier (1-5 scale, 3 = neutral)
    const powerMod = 0.7 + (attacker.data.stats.power * 0.1);
    // Apply defender's defense stat modifier
    const defMod = 1.1 - (defender.data.stats.defense * 0.04);
    damage = Math.round(damage * powerMod * defMod);

    // Attacker gains special meter from dealing damage (20% of damage dealt)
    attacker.special = Math.min(MAX_SPECIAL, attacker.special + damage * 0.2);

    // Determine hit intensity for visual effects
    const isSpecial = move.type === 'special';
    const isHeavy = move.type && (move.type.startsWith('heavy') || damage >= 12);
    const intensity = isSpecial ? 'special' : isHeavy ? 'heavy' : 'light';

    // Defender takes damage (takeDamage handles block reduction and defender meter gain)
    const ko = defender.takeDamage(damage, attacker.sprite.x);

    // --- Visual feedback ---

    // Hit spark particles at the point of impact
    const hitX = (attacker.sprite.x + defender.sprite.x) / 2;
    const hitY = defender.sprite.y - 35;
    if (this.scene.spawnHitSpark) {
      this.scene.spawnHitSpark(hitX, hitY, intensity);
    }

    // Camera shake scaled by intensity
    if (intensity === 'special') {
      this.scene.cameras.main.shake(200, 0.012);
    } else if (intensity === 'heavy') {
      this.scene.cameras.main.shake(100, 0.006);
    } else {
      this.scene.cameras.main.shake(50, 0.002);
    }

    // Fighter tint feedback: white flash on attacker, red tint on defender
    if (attacker.sprite && attacker.sprite.setTint) {
      attacker.sprite.setTint(0xffffff);
      this.scene.time.delayedCall(80, () => {
        if (attacker.sprite && attacker.sprite.clearTint) attacker.sprite.clearTint();
      });
    }
    if (defender.sprite && defender.sprite.setTint) {
      defender.sprite.setTint(0xff4444);
      this.scene.time.delayedCall(150, () => {
        if (defender.sprite && defender.sprite.clearTint) defender.sprite.clearTint();
      });
    }

    if (ko) {
      this.handleKO(attacker, defender);
    }
  }

  timeUp() {
    this.stopRound();
    this._lastEndReason = 'timeup';
    // Player with more HP wins
    const p1 = this.scene.p1Fighter;
    const p2 = this.scene.p2Fighter;
    if (p1.hp > p2.hp) {
      this.roundWin(0);
    } else if (p2.hp > p1.hp) {
      this.roundWin(1);
    } else {
      // Draw - give it to P1 for simplicity
      this.roundWin(0);
    }
  }

  handleKO(winner, loser) {
    this.stopRound();
    const winnerIndex = winner.playerIndex;
    // Dramatic KO shake
    this.scene.cameras.main.shake(300, 0.015);
    // KO screen flash
    if (this.scene.flashScreen) {
      this.scene.flashScreen();
    }
    this.roundWin(winnerIndex);
  }

  roundWin(playerIndex) {
    if (playerIndex === 0) this.p1RoundsWon++;
    else this.p2RoundsWon++;

    // Check match over
    if (this.p1RoundsWon >= ROUNDS_TO_WIN || this.p2RoundsWon >= ROUNDS_TO_WIN) {
      this.matchOver = true;
      this.scene.onMatchOver(playerIndex);
    } else {
      this.roundNumber++;
      this.scene.onRoundOver(playerIndex);
    }
  }

  reset() {
    this.roundNumber = 1;
    this.p1RoundsWon = 0;
    this.p2RoundsWon = 0;
    this.timer = ROUND_TIME;
    this.roundActive = false;
    this.matchOver = false;
    if (this.timerEvent) {
      this.timerEvent.remove();
      this.timerEvent = null;
    }
  }
}
