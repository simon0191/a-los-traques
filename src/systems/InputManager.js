import Phaser from 'phaser';

export class InputManager {
  constructor(scene) {
    this.scene = scene;

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
    return Phaser.Input.Keyboard.JustDown(this.keys.z) || this.touchState.lightPunch;
  }
  get heavyPunch() {
    return Phaser.Input.Keyboard.JustDown(this.keys.a) || this.touchState.heavyPunch;
  }
  get lightKick() {
    return Phaser.Input.Keyboard.JustDown(this.keys.x) || this.touchState.lightKick;
  }
  get heavyKick() {
    return Phaser.Input.Keyboard.JustDown(this.keys.s) || this.touchState.heavyKick;
  }
  get special() {
    return Phaser.Input.Keyboard.JustDown(this.keys.d) || this.touchState.special;
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
