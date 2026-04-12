import Phaser from 'phaser';
import { INPUT_PROFILES } from './InputProfiles.js';

export class InputManager {
  constructor(scene, profileId = 'keyboard_full') {
    this.scene = scene;

    const profile = INPUT_PROFILES[profileId];
    if (!profile) {
      throw new Error(`Unknown input profile: ${profileId}`);
    }

    // Directions
    const dirs = profile.dirs;
    const isArrows =
      dirs.up === Phaser.Input.Keyboard.KeyCodes.UP &&
      dirs.down === Phaser.Input.Keyboard.KeyCodes.DOWN &&
      dirs.left === Phaser.Input.Keyboard.KeyCodes.LEFT &&
      dirs.right === Phaser.Input.Keyboard.KeyCodes.RIGHT;

    if (isArrows) {
      this.cursors = scene.input.keyboard.createCursorKeys();
    } else {
      this.cursors = {
        up: scene.input.keyboard.addKey(dirs.up),
        down: scene.input.keyboard.addKey(dirs.down),
        left: scene.input.keyboard.addKey(dirs.left),
        right: scene.input.keyboard.addKey(dirs.right),
      };
    }

    // Attacks
    const atk = profile.attacks;
    this.keys = {
      lp: scene.input.keyboard.addKey(atk.lp),
      hp: scene.input.keyboard.addKey(atk.hp),
      lk: scene.input.keyboard.addKey(atk.lk),
      hk: scene.input.keyboard.addKey(atk.hk),
      sp: scene.input.keyboard.addKey(atk.sp),
    };

    // Touch input state (populated by TouchControls)
    this.touchState = {
      left: false,
      right: false,
      up: false,
      down: false,
      lightPunch: false,
      heavyPunch: false,
      lightKick: false,
      heavyKick: false,
      special: false,
    };
  }

  get left() {
    return this.cursors.left.isDown || this.touchState.left;
  }
  get right() {
    return this.cursors.right.isDown || this.touchState.right;
  }
  get up() {
    return this.cursors.up.isDown || this.touchState.up;
  }
  get down() {
    return this.cursors.down.isDown || this.touchState.down;
  }

  get lightPunch() {
    return Phaser.Input.Keyboard.JustDown(this.keys.lp) || this.touchState.lightPunch;
  }
  get heavyPunch() {
    return Phaser.Input.Keyboard.JustDown(this.keys.hp) || this.touchState.heavyPunch;
  }
  get lightKick() {
    return Phaser.Input.Keyboard.JustDown(this.keys.lk) || this.touchState.lightKick;
  }
  get heavyKick() {
    return Phaser.Input.Keyboard.JustDown(this.keys.hk) || this.touchState.heavyKick;
  }
  get special() {
    return Phaser.Input.Keyboard.JustDown(this.keys.sp) || this.touchState.special;
  }
  get block() {
    return this.down;
  }

  // Reset one-shot touch inputs after reading
  consumeTouch() {
    this.touchState.lightPunch = false;
    this.touchState.heavyPunch = false;
    this.touchState.lightKick = false;
    this.touchState.heavyKick = false;
    this.touchState.special = false;
  }
}
