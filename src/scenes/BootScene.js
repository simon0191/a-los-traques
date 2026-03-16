import Phaser from 'phaser';
import { FIGHTER_WIDTH, FIGHTER_HEIGHT, FIGHTER_COLORS } from '../config.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    // Generate placeholder rectangle textures for fighters
    this.generateFighterPlaceholder('fighter_p1', FIGHTER_COLORS.p1);
    this.generateFighterPlaceholder('fighter_p2', FIGHTER_COLORS.p2);

    // Generate health bar textures
    this.generateRect('hp_bar_bg', 150, 12, 0x333333);
    this.generateRect('hp_bar_fill', 150, 12, 0x00cc44);
    this.generateRect('hp_bar_fill_p2', 150, 12, 0x00cc44);
    this.generateRect('special_bar_bg', 100, 8, 0x333333);
    this.generateRect('special_bar_fill', 100, 8, 0xffcc00);

    // If URL has ?room=, go directly to lobby as joiner
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    if (roomId) {
      this.scene.start('LobbyScene', { roomId });
    } else {
      this.scene.start('TitleScene');
    }
  }

  generateFighterPlaceholder(key, color) {
    const gfx = this.add.graphics();
    // Head (lighter shade) - drawn first at top of texture
    const headColor = Phaser.Display.Color.IntegerToColor(color);
    headColor.lighten(30);
    gfx.fillStyle(headColor.color, 1);
    gfx.fillCircle(20, 14, 14);
    // Body
    gfx.fillStyle(color, 1);
    gfx.fillRect(6, 28, 28, 52);
    gfx.generateTexture(key, 40, 80);
    gfx.destroy();
  }

  generateRect(key, w, h, color) {
    const gfx = this.add.graphics();
    gfx.fillStyle(color, 1);
    gfx.fillRect(0, 0, w, h);
    gfx.generateTexture(key, w, h);
    gfx.destroy();
  }
}
