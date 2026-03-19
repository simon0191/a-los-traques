import { STAGE_LEFT, STAGE_RIGHT } from '../config.js';

export class Projectile {
  constructor(scene, x, y, direction, speed, damage) {
    this.scene = scene;
    this.damage = damage;
    this.direction = direction; // 1 = right, -1 = left
    this.speed = speed || 200;
    this.active = true;

    // Create a small colored rectangle
    this.sprite = scene.add.rectangle(x, y, 16, 8, 0xffcc00);
    this.sprite.setDepth(5);
    scene.game.audioManager.play('projectile_fire');
  }

  update(delta) {
    if (!this.active) return;
    this.sprite.x += this.direction * this.speed * (delta / 1000);

    // Destroy if off screen
    if (this.sprite.x < STAGE_LEFT - 20 || this.sprite.x > STAGE_RIGHT + 20) {
      this.destroy();
    }
  }

  destroy() {
    this.active = false;
    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }
  }
}
