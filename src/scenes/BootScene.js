import Phaser from 'phaser';
import { FIGHTER_WIDTH, FIGHTER_HEIGHT, FIGHTER_COLORS } from '../config.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // Music
    this.load.audio('bgm_menu', 'assets/audio/bgm_menu.mp3');
    this.load.audio('bgm_fight', 'assets/audio/bgm_fight.mp3');
    this.load.audio('bgm_victory', 'assets/audio/bgm_victory.mp3');
    // Combat SFX
    this.load.audio('hit_light', 'assets/audio/hit_light.mp3');
    this.load.audio('hit_heavy', 'assets/audio/hit_heavy.mp3');
    this.load.audio('hit_special', 'assets/audio/hit_special.mp3');
    this.load.audio('hit_block', 'assets/audio/hit_block.mp3');
    this.load.audio('whiff', 'assets/audio/whiff.mp3');
    this.load.audio('ko', 'assets/audio/ko.mp3');
    this.load.audio('jump', 'assets/audio/jump.mp3');
    this.load.audio('special_charge', 'assets/audio/special_charge.mp3');
    this.load.audio('projectile_fire', 'assets/audio/projectile_fire.mp3');
    // Announcer
    this.load.audio('announce_round', 'assets/audio/announce_round.mp3');
    this.load.audio('announce_fight', 'assets/audio/announce_fight.mp3');
    this.load.audio('announce_ko', 'assets/audio/announce_ko.mp3');
    this.load.audio('announce_timeup', 'assets/audio/announce_timeup.mp3');
    this.load.audio('announce_victory', 'assets/audio/announce_victory.mp3');
    // UI
    this.load.audio('ui_navigate', 'assets/audio/ui_navigate.mp3');
    this.load.audio('ui_confirm', 'assets/audio/ui_confirm.mp3');
    this.load.audio('ui_cancel', 'assets/audio/ui_cancel.mp3');
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
