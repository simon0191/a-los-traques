import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { BracketScene } from './scenes/BracketScene.js';
import { FightScene } from './scenes/FightScene.js';
import { InspectorScene } from './scenes/InspectorScene.js';
import { LearningScene } from './scenes/LearningScene.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { MusicScene } from './scenes/MusicScene.js';
import { PreFightScene } from './scenes/PreFightScene.js';
import { SelectScene } from './scenes/SelectScene.js';
import { SpectatorLobbyScene } from './scenes/SpectatorLobbyScene.js';
import { StageSelectScene } from './scenes/StageSelectScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { TournamentSetupScene } from './scenes/TournamentSetupScene.js';
import { VictoryScene } from './scenes/VictoryScene.js';
import { AudioManager } from './systems/AudioManager.js';
import { AutoplayController } from './systems/AutoplayController.js';

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  pixelArt: true,
  backgroundColor: '#1a1a2e',
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
    TitleScene,
    TournamentSetupScene,
    BracketScene,
    LobbyScene,
    SpectatorLobbyScene,
    SelectScene,
    StageSelectScene,
    PreFightScene,
    FightScene,
    VictoryScene,
    InspectorScene,
    MusicScene,
    LearningScene,
  ],
};

window.game = new Phaser.Game(config);
window.game.autoplay = new AutoplayController();
new AudioManager(window.game);
