import Phaser from 'phaser';

export class InputManager {
  constructor(scene, gamepadIndex = 0) {
    this.scene = scene;
    this.gamepadIndex = gamepadIndex;

    // Keyboard
    this.cursors = scene.input.keyboard.createCursorKeys();
    this.keys = {
      z: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      x: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X),
      a: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      space: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
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
    if (!this.scene.input.gamepad) return null;
    // Check if the gamepad at the expected index exists
    return this.scene.input.gamepad.gamepads[this.gamepadIndex];
  }

  get left() {
    const pad = this._getGamepad();
    const padLeft = pad && (pad.left || (pad.axes[0] && pad.axes[0].getValue() < -0.5));
    return this.cursors.left.isDown || this.touchState.left || padLeft;
  }
  get right() {
    const pad = this._getGamepad();
    const padRight = pad && (pad.right || (pad.axes[0] && pad.axes[0].getValue() > 0.5));
    return this.cursors.right.isDown || this.touchState.right || padRight;
  }
  get up() {
    const pad = this._getGamepad();
    const padUp = pad && (pad.up || (pad.axes[1] && pad.axes[1].getValue() < -0.5));
    return this.cursors.up.isDown || this.touchState.up || padUp;
  }
  get down() {
    const pad = this._getGamepad();
    const padDown = pad && (pad.down || (pad.axes[1] && pad.axes[1].getValue() > 0.5));
    return this.cursors.down.isDown || this.touchState.down || padDown;
  }

  get lightPunch() {
    return Phaser.Input.Keyboard.JustDown(this.keys.z) || this.touchState.lightPunch || this._padJustDown(2);
  }
  get heavyPunch() {
    return Phaser.Input.Keyboard.JustDown(this.keys.a) || this.touchState.heavyPunch || this._padJustDown(3);
  }
  get lightKick() {
    return Phaser.Input.Keyboard.JustDown(this.keys.x) || this.touchState.lightKick || this._padJustDown(0);
  }
  get heavyKick() {
    return Phaser.Input.Keyboard.JustDown(this.keys.s) || this.touchState.heavyKick || this._padJustDown(1);
  }
  get special() {
    return (
      Phaser.Input.Keyboard.JustDown(this.keys.d) ||
      this.touchState.special ||
      this._padJustDown(5) ||
      this._padJustDown(7)
    );
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
