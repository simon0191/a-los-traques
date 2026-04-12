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
    const pad = this._getGamepad();
    // Square (Button 2)
    const padPress = pad?.buttons[2]?.pressed;
    return Phaser.Input.Keyboard.JustDown(this.keys.z) || this.touchState.lightPunch || padPress;
  }
  get heavyPunch() {
    const pad = this._getGamepad();
    // Triangle (Button 3)
    const padPress = pad?.buttons[3]?.pressed;
    return Phaser.Input.Keyboard.JustDown(this.keys.a) || this.touchState.heavyPunch || padPress;
  }
  get lightKick() {
    const pad = this._getGamepad();
    // Cross (Button 0)
    const padPress = pad?.buttons[0]?.pressed;
    return Phaser.Input.Keyboard.JustDown(this.keys.x) || this.touchState.lightKick || padPress;
  }
  get heavyKick() {
    const pad = this._getGamepad();
    // Circle (Button 1)
    const padPress = pad?.buttons[1]?.pressed;
    return Phaser.Input.Keyboard.JustDown(this.keys.s) || this.touchState.heavyKick || padPress;
  }
  get special() {
    const pad = this._getGamepad();
    // R1 (Button 5) or R2 (Button 7)
    const padPress = pad?.buttons[5]?.pressed || pad?.buttons[7]?.pressed;
    return Phaser.Input.Keyboard.JustDown(this.keys.d) || this.touchState.special || padPress;
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
