import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { SelectScene } from './scenes/SelectScene.js';
import { PreFightScene } from './scenes/PreFightScene.js';
import { FightScene } from './scenes/FightScene.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { SpectatorLobbyScene } from './scenes/SpectatorLobbyScene.js';
import { VictoryScene } from './scenes/VictoryScene.js';
import { InspectorScene } from './scenes/InspectorScene.js';
import { MusicScene } from './scenes/MusicScene.js';
import { AudioManager } from './systems/AudioManager.js';

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
      debug: false
    }
  },
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BootScene, TitleScene, LobbyScene, SpectatorLobbyScene, SelectScene, PreFightScene, FightScene, VictoryScene, InspectorScene, MusicScene]
};

window.game = new Phaser.Game(config);
new AudioManager(window.game);
