import Phaser from 'phaser';
import { FIGHTER_WIDTH, FIGHTER_HEIGHT, FIGHTER_COLORS } from '../config.js';
import fightersData from '../data/fighters.json';

// Auto-discover fight music MP3s at build time via Vite glob
const fightMusicFiles = Object.keys(
  import.meta.glob('/public/assets/audio/fights/*.mp3')
).map(p => p.replace('/public', ''));


// Animation definitions: name -> frame count
const ANIM_DEFS = {
  idle:         { frames: 4, repeat: -1 },
  walk:         { frames: 4, repeat: -1 },
  light_punch:  { frames: 4, repeat: 0 },
  heavy_punch:  { frames: 5, repeat: 0 },
  light_kick:   { frames: 4, repeat: 0 },
  heavy_kick:   { frames: 5, repeat: 0 },
  special:      { frames: 5, repeat: 0 },
  block:        { frames: 2, repeat: 0 },
  hurt:         { frames: 3, repeat: 0 },
  knockdown:    { frames: 4, repeat: 0 },
  victory:      { frames: 4, repeat: -1 },
  defeat:       { frames: 3, repeat: 0 },
  jump:         { frames: 3, repeat: 0 },
};

// Fighters that have real sprite assets (add IDs here as they're generated)
const FIGHTERS_WITH_SPRITES = ['simon', 'jeka', 'chicha', 'cata', 'carito', 'mao', 'peks', 'lini', 'alv', 'sun', 'gartner', 'richi', 'cami', 'migue', 'bozzi', 'angy'];

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // Music
    this.load.audio('bgm_menu', 'assets/audio/bgm_menu.mp3');
    this.load.audio('bgm_victory', 'assets/audio/bgm_victory.mp3');
    // Fight music: load all MP3s from public/assets/audio/fights/
    for (let i = 0; i < fightMusicFiles.length; i++) {
      this.load.audio(`bgm_fight_${i}`, fightMusicFiles[i]);
    }
    // Fallback to original bgm_fight if no files in fights/ folder
    if (fightMusicFiles.length === 0) {
      this.load.audio('bgm_fight_0', 'assets/audio/bgm_fight.mp3');
    }
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

    // Load fighter sprite sheets and portraits
    for (const id of FIGHTERS_WITH_SPRITES) {
      for (const [animName, def] of Object.entries(ANIM_DEFS)) {
        this.load.spritesheet(
          `fighter_${id}_${animName}`,
          `assets/fighters/${id}/${animName}.png`,
          { frameWidth: FIGHTER_WIDTH, frameHeight: FIGHTER_HEIGHT }
        );
      }
      this.load.image(`portrait_${id}`, `assets/portraits/${id}.png`);
    }
  }

  create() {
    // Store fight music count in registry so FightScene can pick randomly
    const count = fightMusicFiles.length > 0 ? fightMusicFiles.length : 1;
    this.game.registry.set('fightMusicCount', count);

    // Generate placeholder rectangle textures for fighters
    this.generateFighterPlaceholder('fighter_p1', FIGHTER_COLORS.p1);
    this.generateFighterPlaceholder('fighter_p2', FIGHTER_COLORS.p2);

    // Create animations for fighters with real sprites
    for (const id of FIGHTERS_WITH_SPRITES) {
      for (const [animName, def] of Object.entries(ANIM_DEFS)) {
        const key = `fighter_${id}_${animName}`;
        this.anims.create({
          key: `${id}_${animName}`,
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: def.frames - 1 }),
          frameRate: 8,
          repeat: def.repeat,
        });
      }
    }

    // Generate health bar textures
    this.generateRect('hp_bar_bg', 150, 12, 0x333333);
    this.generateRect('hp_bar_fill', 150, 12, 0x00cc44);
    this.generateRect('hp_bar_fill_p2', 150, 12, 0x00cc44);
    this.generateRect('special_bar_bg', 100, 8, 0x333333);
    this.generateRect('special_bar_fill', 100, 8, 0xffcc00);

    // If URL has ?room=, go directly to lobby as joiner or spectator
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    if (roomId && params.get('spectate') === '1') {
      this.scene.start('SpectatorLobbyScene', { roomId });
    } else if (roomId) {
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
