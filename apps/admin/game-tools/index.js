import { configureEnv } from '@alostraques/game/config';
import { BootScene } from '@alostraques/game/scenes/BootScene.js';
import * as Phaser from 'phaser';
import { InspectorScene } from './scenes/InspectorScene.js';
import { OverlayEditorScene } from './scenes/OverlayEditorScene.js';

/**
 * Boot a minimal Phaser game with only the dev scenes registered. BootScene
 * is reused so we get fighter sprites / audio / overlay manifest preloaded
 * just like the player game. After preload, BootScene hands off to the
 * target dev scene via the scene key in `entry`.
 *
 * @param {object} options
 * @param {string | HTMLElement} options.parent
 * @param {'OverlayEditorScene' | 'InspectorScene'} options.entry
 * @param {{ partyKitHost?: string, isDev?: boolean }} [options.env]
 */
export function createDevToolsGame({ parent, entry, env = {} }) {
  configureEnv({
    partyKitHost: env.partyKitHost,
    isDev: env.isDev ?? true,
  });

  if (typeof window !== 'undefined') {
    // BootScene inspects `URLSearchParams` on `window.location`. Forcing the
    // target via `__DEV_TOOLS_ENTRY` tells it which scene to start after
    // preload instead of falling through its regular routing chain.
    window.__DEV_TOOLS_ENTRY = entry;
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
    scene: [BootScene, OverlayEditorScene, InspectorScene],
  };

  return new Phaser.Game(config);
}
