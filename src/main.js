import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config.js';
import { Logger } from './systems/Logger.js';

const log = Logger.create('Main');

import { AccessorySelectScene } from './scenes/AccessorySelectScene.js';
import { BootScene } from './scenes/BootScene.js';
import { BracketScene } from './scenes/BracketScene.js';
import { ControllerScene } from './scenes/ControllerScene.js';
import { FightScene } from './scenes/FightScene.js';
import { InspectorScene } from './scenes/InspectorScene.js';
import { LeaderboardScene } from './scenes/LeaderboardScene.js';
import { LearningScene } from './scenes/LearningScene.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { LoginScene } from './scenes/LoginScene.js';
import { MultiplayerMenuScene } from './scenes/MultiplayerMenuScene.js';
import { MusicScene } from './scenes/MusicScene.js';
import { OverlayEditorScene } from './scenes/OverlayEditorScene.js';
import { PreFightScene } from './scenes/PreFightScene.js';
import { SelectScene } from './scenes/SelectScene.js';
import { SpectatorLobbyScene } from './scenes/SpectatorLobbyScene.js';
import { StageSelectScene } from './scenes/StageSelectScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { TournamentSetupScene } from './scenes/TournamentSetupScene.js';
import { VictoryScene } from './scenes/VictoryScene.js';
import { onAuthStateChange } from './services/supabase.js';
import { AudioManager } from './systems/AudioManager.js';
import { AutoplayController } from './systems/AutoplayController.js';

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  pixelArt: true,
  backgroundColor: '#1a1a2e',
  dom: {
    createContainer: true,
  },
  input: {
    gamepad: true,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  parent: 'game-container',
  fps: {
    target: 60,
    forceSetTimeOut: false,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [
    BootScene,
    LoginScene,
    TitleScene,
    MultiplayerMenuScene,
    TournamentSetupScene,
    BracketScene,
    LobbyScene,
    SpectatorLobbyScene,
    SelectScene,
    AccessorySelectScene,
    StageSelectScene,
    PreFightScene,
    FightScene,
    VictoryScene,
    InspectorScene,
    MusicScene,
    LeaderboardScene,
    LearningScene,
    ControllerScene,
  ],
};

// Dev-only: register the overlay editor when `?editor=1` is in the URL (RFC 0018).
const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
if (urlParams.get('editor') === '1') {
  config.scene.push(OverlayEditorScene);
}

window.game = new Phaser.Game(config);
window.game.autoplay = new AutoplayController();
new AudioManager(window.game);

// Initialize Auth State
onAuthStateChange((event, session) => {
  log.info('Auth state change', { event });
  window.game.registry.set('user', session?.user || null);
});
