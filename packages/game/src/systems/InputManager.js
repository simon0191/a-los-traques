import * as Phaser from 'phaser';
import { INPUT_PROFILES } from './InputProfiles.js';

export class InputManager {
  constructor(scene, profileId = 'keyboard_full') {
    this.scene = scene;
    this.profileId = profileId;

    const profile = INPUT_PROFILES[profileId];
    if (!profile) {
      throw new Error(`Unknown input profile: ${profileId}`);
    }

    this.profile = profile;
    this.gamepadIndex = profile.type === 'gamepad' ? profile.index : -1;

    if (profile.type === 'keyboard') {
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
    } else {
      // Gamepad mode: cursors and keys are dummy or not used
      this.cursors = {
        up: { isDown: false },
        down: { isDown: false },
        left: { isDown: false },
        right: { isDown: false },
      };
      this.keys = {
        lp: null,
        hp: null,
        lk: null,
        hk: null,
        sp: null,
      };
    }

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

    // Button state tracking for 'Just Down'
    this._prevPadButtons = new Array(16).fill(false);
    this._currPadButtons = new Array(16).fill(false);
  }

  preUpdate() {
    const pad = this._getGamepad();
    for (let i = 0; i < this._currPadButtons.length; i++) {
      this._prevPadButtons[i] = this._currPadButtons[i];
      this._currPadButtons[i] = !!pad?.buttons[i]?.pressed;
    }
  }

  _padJustDown(buttonIndex) {
    return this._currPadButtons[buttonIndex] && !this._prevPadButtons[buttonIndex];
  }

  _getGamepad() {
    if (this.gamepadIndex === -1 || !this.scene.input.gamepad) return null;
    // Check if the gamepad at the expected index exists
    return this.scene.input.gamepad.gamepads[this.gamepadIndex];
  }

  get left() {
    const pad = this._getGamepad();
    const padLeft = pad && (pad.left || (pad.axes[0] && pad.axes[0].getValue() < -0.5));
    return this.cursors.left?.isDown || this.touchState.left || padLeft;
  }
  get right() {
    const pad = this._getGamepad();
    const padRight = pad && (pad.right || (pad.axes[0] && pad.axes[0].getValue() > 0.5));
    return this.cursors.right?.isDown || this.touchState.right || padRight;
  }
  get up() {
    const pad = this._getGamepad();
    const padUp = pad && (pad.up || (pad.axes[1] && pad.axes[1].getValue() < -0.5));
    return this.cursors.up?.isDown || this.touchState.up || padUp;
  }
  get down() {
    const pad = this._getGamepad();
    const padDown = pad && (pad.down || (pad.axes[1] && pad.axes[1].getValue() > 0.5));
    return this.cursors.down?.isDown || this.touchState.down || padDown;
  }

  get lightPunch() {
    const kb = this.keys.lp ? Phaser.Input.Keyboard.JustDown(this.keys.lp) : false;
    return kb || this.touchState.lightPunch || this._padJustDown(2);
  }
  get heavyPunch() {
    const kb = this.keys.hp ? Phaser.Input.Keyboard.JustDown(this.keys.hp) : false;
    return kb || this.touchState.heavyPunch || this._padJustDown(3);
  }
  get lightKick() {
    const kb = this.keys.lk ? Phaser.Input.Keyboard.JustDown(this.keys.lk) : false;
    return kb || this.touchState.lightKick || this._padJustDown(0);
  }
  get heavyKick() {
    const kb = this.keys.hk ? Phaser.Input.Keyboard.JustDown(this.keys.hk) : false;
    return kb || this.touchState.heavyKick || this._padJustDown(1);
  }
  get special() {
    const kb = this.keys.sp ? Phaser.Input.Keyboard.JustDown(this.keys.sp) : false;
    return kb || this.touchState.special || this._padJustDown(5) || this._padJustDown(7);
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
