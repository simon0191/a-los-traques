import Phaser from 'phaser';
import {
  FIGHTER_COLORS,
  FIGHTER_HEIGHT,
  FIGHTER_WIDTH,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config.js';
import stages from '../data/stages.json';
import { authEnabled } from '../services/supabase.js';

// Auto-discover fight music MP3s at build time via Vite glob
const fightMusicFiles = Object.keys(import.meta.glob('/public/assets/audio/fights/*.mp3')).map(
  (p) => p.replace('/public', ''),
);

// Animation definitions: name -> frame count
const ANIM_DEFS = {
  idle: { frames: 4, repeat: -1 },
  walk: { frames: 4, repeat: -1 },
  light_punch: { frames: 4, repeat: 0 },
  heavy_punch: { frames: 5, repeat: 0 },
  light_kick: { frames: 4, repeat: 0 },
  heavy_kick: { frames: 5, repeat: 0 },
  special: { frames: 5, repeat: 0 },
  block: { frames: 2, repeat: 0 },
  hurt: { frames: 3, repeat: 0 },
  knockdown: { frames: 4, repeat: 0 },
  victory: { frames: 4, repeat: -1 },
  defeat: { frames: 3, repeat: 0 },
  jump: { frames: 3, repeat: 0 },
};

// Fighters that have real sprite assets (add IDs here as they're generated)
const FIGHTERS_WITH_SPRITES = [
  'simon',
  'jeka',
  'chicha',
  'cata',
  'carito',
  'mao',
  'peks',
  'lini',
  'alv',
  'sun',
  'gartner',
  'richi',
  'cami',
  'migue',
  'bozzi',
  'angy',
];

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

    // Button Icons
    this.load.image('btn_lp', 'assets/ui/btn_lp.png');
    this.load.image('btn_hp', 'assets/ui/btn_hp.png');
    this.load.image('btn_lk', 'assets/ui/btn_lk.png');
    this.load.image('btn_hk', 'assets/ui/btn_hk.png');
    this.load.image('btn_special', 'assets/ui/btn_special.png');

    // Load stage background images (only for those that have actual image files)
    for (const stage of stages) {
      if (stage.texture?.startsWith('stages_')) {
        if (stage.animated) {
          this.load.spritesheet(stage.texture, `assets/stages/${stage.texture}.png`, {
            frameWidth: GAME_WIDTH,
            frameHeight: GAME_HEIGHT,
          });
        } else {
          this.load.image(stage.texture, `assets/stages/${stage.texture}.png`);
        }
      }
    }

    // Load stage-specific soundtracks
    for (const stage of stages) {
      if (stage.soundtrack) {
        for (let i = 0; i < stage.soundtrack.length; i++) {
          this.load.audio(
            `bgm_stage_${stage.id}_${i}`,
            `assets/audio/stages/${stage.id}/${stage.soundtrack[i]}`,
          );
        }
      }
    }

    // Load fighter sprite sheets and portraits
    for (const id of FIGHTERS_WITH_SPRITES) {
      for (const [animName, _def] of Object.entries(ANIM_DEFS)) {
        this.load.spritesheet(
          `fighter_${id}_${animName}`,
          `assets/fighters/${id}/${animName}.png`,
          { frameWidth: FIGHTER_WIDTH, frameHeight: FIGHTER_HEIGHT },
        );
      }
      this.load.image(`portrait_${id}`, `assets/portraits/${id}.png`);
    }

    // Accessory source images for the overlay editor (RFC 0018 MVP: hat only).
    // These are the raw art that the editor composites per-frame into strips.
    const ACCESSORY_IDS = ['sombrero_catalina'];
    for (const id of ACCESSORY_IDS) {
      this.load.image(`accessory_${id}`, `assets/accessories/${id}.png`);
    }

    // Overlay manifest + baked strips (RFC 0018 v2). Loaded via Phaser so
    // `filecomplete` lets us queue the per-combo spritesheets before create().
    this.load.json('overlayManifestData', 'assets/overlays/manifest.json');
    this.load.on('filecomplete-json-overlayManifestData', (_key, _type, manifest) => {
      const calibs = manifest?.calibrations;
      if (!calibs) return;
      for (const [fighterId, byAcc] of Object.entries(calibs)) {
        for (const [accessoryId, byAnim] of Object.entries(byAcc)) {
          for (const anim of Object.keys(byAnim)) {
            const key = `overlay_${fighterId}_${accessoryId}_${anim}`;
            const url = `assets/overlays/${fighterId}/${accessoryId}_${anim}.png`;
            this.load.spritesheet(key, url, {
              frameWidth: FIGHTER_WIDTH,
              frameHeight: FIGHTER_HEIGHT,
            });
          }
        }
      }
    });
  }

  create() {
    // Store fight music count in registry so FightScene can pick randomly
    const count = fightMusicFiles.length > 0 ? fightMusicFiles.length : 1;
    this.game.registry.set('fightMusicCount', count);

    // Overlay manifest (RFC 0018 v2). Loaded via this.load.json in preload;
    // fall back to empty if missing so the game still boots.
    const manifest = this.cache.json.get('overlayManifestData') ?? {
      version: 2,
      updatedAt: null,
      calibrations: {},
    };
    this.game.registry.set('overlayManifest', manifest);

    // Create animations for the baked overlay strips that loaded successfully.
    for (const [fighterId, byAcc] of Object.entries(manifest.calibrations ?? {})) {
      for (const [accessoryId, byAnim] of Object.entries(byAcc)) {
        for (const [animName, entry] of Object.entries(byAnim)) {
          const key = `overlay_${fighterId}_${accessoryId}_${animName}`;
          if (!this.textures.exists(key)) continue;
          const def = ANIM_DEFS[animName];
          this.anims.create({
            key,
            frames: this.anims.generateFrameNumbers(key, {
              start: 0,
              end: (def?.frames ?? entry.frameCount) - 1,
            }),
            frameRate: 8,
            repeat: def?.repeat ?? -1,
          });
        }
      }
    }

    // Generate placeholder rectangle textures for fighters
    this.generateFighterPlaceholder('fighter_p1', FIGHTER_COLORS.p1);
    this.generateFighterPlaceholder('fighter_p2', FIGHTER_COLORS.p2);

    // Generate placeholder rectangle textures for stages (if no real assets)
    for (const stage of stages) {
      if (!this.textures.exists(stage.texture)) {
        this.generateRect(
          stage.texture,
          this.game.config.width,
          this.game.config.height,
          Phaser.Display.Color.HexStringToColor(stage.bgColor).color,
        );
      }
    }

    // Create animations for animated stages
    for (const stage of stages) {
      if (stage.animated && this.textures.exists(stage.texture)) {
        this.anims.create({
          key: `stage_anim_${stage.id}`,
          frames: this.anims.generateFrameNumbers(stage.texture, {
            start: 0,
            end: stage.animFrames - 1,
          }),
          frameRate: stage.animFrameRate || 6,
          repeat: -1,
        });
      }
    }

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
    this.generateRect('white_pixel', 2, 2, 0xffffff);

    // Parse debug mode URL param
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') {
      this.game.debugMode = true;
      // Import Logger dynamically to avoid circular deps in BootScene
      import('../systems/Logger.js').then(({ Logger, LogLevel }) => {
        Logger.setGlobalLevel(LogLevel.DEBUG);
      });
    }

    // If URL has ?room=, go directly to lobby as joiner or spectator
    const roomId = params.get('room');
    // Replay mode: load bundle from window global or sessionStorage
    if (this.game.autoplay?.replay) {
      if (!window.__REPLAY_BUNDLE) {
        const stored = sessionStorage.getItem('__REPLAY_BUNDLE');
        if (stored) window.__REPLAY_BUNDLE = JSON.parse(stored);
      }
    }
    // Editor routing (RFC 0018): skip login/title if ?editor=1 is present.
    if (params.get('editor') === '1' && this.scene.get('OverlayEditorScene')) {
      this.scene.start('OverlayEditorScene');
    } else if (this.game.autoplay?.replay && window.__REPLAY_BUNDLE) {
      // Skip lobby, go straight to fight using bundle config
      const bundle = window.__REPLAY_BUNDLE;
      this.scene.start('PreFightScene', {
        p1Id: bundle.config.p1FighterId,
        p2Id: bundle.config.p2FighterId,
        stageId: bundle.config.stageId,
        gameMode: 'local',
      });
    } else if (roomId && params.get('spectate') === '1') {
      this.scene.start('SpectatorLobbyScene', { roomId });
    } else if (roomId) {
      this.scene.start('LobbyScene', { roomId });
    } else if (this.game.autoplay?.enabled && this.game.autoplay.createRoom) {
      // Autoplay mode: create a new room automatically
      this.scene.start('LobbyScene', {});
    } else if (!authEnabled || this.game.autoplay?.enabled) {
      // Bypass login if Supabase not configured or in E2E/autoplay mode
      this.scene.start('TitleScene');
    } else {
      this.scene.start('LoginScene');
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
