import * as Phaser from 'phaser';
import { configureEnv } from './config.js';
import { AccessorySelectScene } from './scenes/AccessorySelectScene.js';
import { BootScene } from './scenes/BootScene.js';
import { BracketScene } from './scenes/BracketScene.js';
import { ControllerScene } from './scenes/ControllerScene.js';
import { FightScene } from './scenes/FightScene.js';
import { LeaderboardScene } from './scenes/LeaderboardScene.js';
import { LearningScene } from './scenes/LearningScene.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { LoginScene } from './scenes/LoginScene.js';
import { MultiplayerMenuScene } from './scenes/MultiplayerMenuScene.js';
import { MusicScene } from './scenes/MusicScene.js';
import { PreFightScene } from './scenes/PreFightScene.js';
import { SelectScene } from './scenes/SelectScene.js';
import { SpectatorLobbyScene } from './scenes/SpectatorLobbyScene.js';
import { StageSelectScene } from './scenes/StageSelectScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { TournamentSetupScene } from './scenes/TournamentSetupScene.js';
import { VictoryScene } from './scenes/VictoryScene.js';
import { initAuthEnv, onAuthStateChange } from './services/supabase.js';
import { AudioManager } from './systems/AudioManager.js';
import { AutoplayController } from './systems/AutoplayController.js';
import { Logger } from './systems/Logger.js';

const log = Logger.create('Main');

const BASE_SCENES = [
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
  MusicScene,
  LeaderboardScene,
  LearningScene,
  ControllerScene,
];

/**
 * Create and start the Phaser game.
 *
 * @param {object} [options]
 * @param {string | HTMLElement} [options.parent='game-container'] - DOM mount point.
 * @param {URLSearchParams | Record<string, string>} [options.params] - Pre-parsed URL params
 *   (`?room`, `?autoplay`, `?debug`, `?replay`, `?seed`, `?speed`, `?partyHost`, etc.).
 *   The factory stashes these on `window.__GAME_PARAMS` so scenes that still read URL
 *   params directly keep working during the migration.
 * @param {{
 *   partyKitHost?: string,
 *   supabaseUrl?: string | null,
 *   supabaseAnonKey?: string | null,
 *   isDev?: boolean,
 * }} [options.env] - Environment values sourced from the host app (Next.js reads
 *   these from `process.env.*` and `/api/public-config`).
 * @param {Phaser.Events.EventEmitter} [options.eventBus] - Optional cross-world bus. Phase 3
 *   accepts the parameter but doesn't wire React listeners yet — reserved for the RFC §3
 *   EventBus work.
 * @returns {Phaser.Game}
 */
export function createGame({ parent = 'game-container', params, env = {}, eventBus = null } = {}) {
  configureEnv({
    partyKitHost: env.partyKitHost,
    isDev: env.isDev ?? (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'),
  });
  initAuthEnv({
    url: env.supabaseUrl ?? null,
    anonKey: env.supabaseAnonKey ?? null,
  });

  if (typeof window !== 'undefined') {
    window.__GAME_PARAMS =
      params instanceof URLSearchParams
        ? params
        : new URLSearchParams(params ?? window.location.search);
    window.__GAME_EVENT_BUS = eventBus;
  }

  const config = {
    type: Phaser.AUTO,
    width: 480,
    height: 270,
    pixelArt: true,
    backgroundColor: '#1a1a2e',
    dom: { createContainer: true },
    input: { gamepad: true },
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: 0 }, debug: false },
    },
    parent,
    fps: { target: 60, forceSetTimeOut: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [...BASE_SCENES],
  };

  const game = new Phaser.Game(config);
  game.autoplay = new AutoplayController();
  new AudioManager(game);

  if (typeof window !== 'undefined') {
    window.game = game;
  }

  onAuthStateChange((event, session) => {
    log.info('Auth state change', { event });
    game.registry.set('user', session?.user || null);
  });

  return game;
}
