/**
 * Canonical animation frame-counts and the list of fighters that have real
 * sprite sheets. Single source of truth — BootScene, OverlayEditorScene,
 * InspectorScene, and the asset-pipeline CLIs all import from here.
 *
 * Adding a new fighter with sprites: append to `FIGHTERS_WITH_SPRITES` once;
 * every consumer picks it up. Adding a new animation: extend `ANIM_DEFS`.
 */

export const ANIM_DEFS = {
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

export const ANIM_NAMES = Object.keys(ANIM_DEFS);

export const FIGHTERS_WITH_SPRITES = [
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
  'adil',
];
