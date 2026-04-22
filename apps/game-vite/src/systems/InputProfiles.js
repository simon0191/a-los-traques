import Phaser from 'phaser';

/**
 * Input profile definitions.
 * Each profile maps directions and attacks to Phaser key codes.
 * Extensible — add gamepad profiles here when controller support lands.
 */
export const INPUT_PROFILES = {
  keyboard_full: {
    name: 'Teclado Completo',
    type: 'keyboard',
    dirs: {
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    },
    attacks: {
      lp: Phaser.Input.Keyboard.KeyCodes.Z,
      hp: Phaser.Input.Keyboard.KeyCodes.A,
      lk: Phaser.Input.Keyboard.KeyCodes.X,
      hk: Phaser.Input.Keyboard.KeyCodes.S,
      sp: Phaser.Input.Keyboard.KeyCodes.D,
    },
  },
  keyboard_left: {
    name: 'Teclado Izquierdo',
    type: 'keyboard',
    dirs: {
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    },
    attacks: {
      lp: Phaser.Input.Keyboard.KeyCodes.F,
      hp: Phaser.Input.Keyboard.KeyCodes.G,
      lk: Phaser.Input.Keyboard.KeyCodes.C,
      hk: Phaser.Input.Keyboard.KeyCodes.V,
      sp: Phaser.Input.Keyboard.KeyCodes.T,
    },
  },
  keyboard_right: {
    name: 'Teclado Derecho',
    type: 'keyboard',
    dirs: {
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    },
    attacks: {
      lp: Phaser.Input.Keyboard.KeyCodes.I,
      hp: Phaser.Input.Keyboard.KeyCodes.O,
      lk: Phaser.Input.Keyboard.KeyCodes.K,
      hk: Phaser.Input.Keyboard.KeyCodes.L,
      sp: Phaser.Input.Keyboard.KeyCodes.P,
    },
  },
  gamepad_0: {
    name: 'Mando 1',
    type: 'gamepad',
    index: 0,
  },
  gamepad_1: {
    name: 'Mando 2',
    type: 'gamepad',
    index: 1,
  },
};
