import * as Phaser from 'phaser';
import { GAME_WIDTH } from '../config.js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('ControllerScene');

export class ControllerScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ControllerScene', active: true });
    this.menuItems = [];
    this.isGrid = false;
    this.cursorX = 0;
    this.cursorY = 0;

    // Input repeat timers
    this.padTimers = { up: 0, down: 0, left: 0, right: 0 };
    this.NAV_DELAY = 300;
    this.NAV_FREQ = 150;

    // Button state tracking for 'Just Down'
    this.prevButtons = {
      cross: false,
      square: false,
      circle: false,
      options: false,
      enter: false,
      space: false,
      esc: false,
    };

    // Visual Cursor State
    this.targetBounds = { x: 0, y: 0, w: 0, h: 0 };
    this.currentBounds = { x: 0, y: 0, w: 0, h: 0 };
    this.LERP_SPEED = 0.25;
    this.cursorVisible = true;
    this.lastSceneKey = '';
  }

  create() {
    this.graphics = this.add.graphics();
    this.graphics.setDepth(10000);

    this.cursors = this.input.keyboard.createCursorKeys();

    // Pre-create keys for performance
    this.keys = {
      enter: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      esc: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
    };

    // Listen for gamepad connections
    this.input.gamepad.on('connected', (_pad) => {
      this.showToast('Control conectado');
    });

    this.input.gamepad.on('disconnected', (_pad) => {
      this.showToast('Control desconectado');
    });

    // Auto-pull menu when scenes change (using scene-scoped event)
    this.events.on('update', () => {
      this._checkActiveScene();
    });
  }

  _checkActiveScene() {
    const mainScene = this._getMainScene();
    if (!mainScene) return;

    if (this.lastSceneKey !== mainScene.scene.key) {
      this.lastSceneKey = mainScene.scene.key;
      log.info(`Scene changed to: ${this.lastSceneKey}`);

      // Pull-based navigation: check if scene provides its own menu
      if (typeof mainScene.getNavMenu === 'function') {
        const config = mainScene.getNavMenu();
        this.setNavMenu(config.items, config.isGrid || false, config.showCursor ?? true);
      } else {
        this.setNavMenu(null);
      }
    }
  }

  _getMainScene() {
    const activeScenes = this.game.scene.getScenes(true);
    // Find the topmost scene that isn't a system utility (searching from end of list)
    return activeScenes
      .slice()
      .reverse()
      .find(
        (s) =>
          s.scene.key !== 'ControllerScene' &&
          s.scene.key !== 'DevConsole' &&
          s.scene.key !== 'AudioManager' &&
          s.scene.key !== 'VFXBridge',
      );
  }

  /**
   * Set the current navigatable menu.
   * @param {GameObject[] | GameObject[][]} items - 1D array or 2D matrix of interactables.
   * @param {boolean} isGrid - Whether the items are a 2D matrix.
   * @param {boolean} showCursor - Whether to show the global yellow selection square.
   */
  setNavMenu(items, isGrid = false, showCursor = true) {
    // Reset previous focus
    const prev = this._getFocusedItem();
    if (prev) prev.emit('pointerout');

    this.menuItems = items || [];
    this.isGrid = isGrid;
    this.cursorVisible = showCursor;
    this.cursorX = 0;
    this.cursorY = 0;

    const focused = this._getFocusedItem();
    if (focused) {
      focused.emit('pointerover');
      this._snapCursorTo(focused);
    } else {
      this.graphics.clear();
    }
  }

  /**
   * Manually set focus to a specific GameObject.
   * @param {GameObject} obj
   */
  focusItem(obj) {
    if (!obj) return;

    // Find indices in current menu
    if (this.isGrid) {
      for (let y = 0; y < this.menuItems.length; y++) {
        const x = this.menuItems[y].indexOf(obj);
        if (x !== -1) {
          const prev = this._getFocusedItem();
          if (prev) prev.emit('pointerout');
          this.cursorX = x;
          this.cursorY = y;
          obj.emit('pointerover');
          this.targetBounds = this._getGlobalBounds(obj);
          return;
        }
      }
    } else {
      const y = this.menuItems.indexOf(obj);
      if (y !== -1) {
        const prev = this._getFocusedItem();
        if (prev) prev.emit('pointerout');
        this.cursorY = y;
        obj.emit('pointerover');
        this.targetBounds = this._getGlobalBounds(obj);
        return;
      }
    }
  }

  _getFocusedItem() {
    if (this.menuItems.length === 0) return null;
    if (this.isGrid) {
      return this.menuItems[this.cursorY]?.[this.cursorX] || null;
    }
    return this.menuItems[this.cursorY] || null;
  }

  _snapCursorTo(obj) {
    const bounds = this._getGlobalBounds(obj);
    this.targetBounds = bounds;
    this.currentBounds = { ...bounds };
  }

  _getGlobalBounds(obj) {
    if (!obj) return { x: 0, y: 0, w: 0, h: 0 };

    // Support containers and normal objects
    const bounds = obj.getBounds ? obj.getBounds() : { x: obj.x, y: obj.y, width: 40, height: 20 };

    return {
      x: bounds.x,
      y: bounds.y,
      w: bounds.width,
      h: bounds.height,
    };
  }

  showToast(message) {
    if (this.toastContainer) this.toastContainer.destroy();
    this.toastContainer = this.add.container(GAME_WIDTH / 2, -30).setDepth(11000);
    const bg = this.add.rectangle(0, 0, 160, 24, 0x000000, 0.8).setStrokeStyle(1, 0x44cc88);
    const text = this.add
      .text(0, 0, message, { fontFamily: 'Arial', fontSize: '10px', color: '#44cc88' })
      .setOrigin(0.5);
    this.toastContainer.add([bg, text]);
    this.tweens.add({
      targets: this.toastContainer,
      y: 20,
      duration: 300,
      ease: 'Back.easeOut',
      yoyo: true,
      hold: 2000,
      onComplete: () => {
        if (this.toastContainer) {
          this.toastContainer.destroy();
          this.toastContainer = null;
        }
      },
    });
  }

  update(time, delta) {
    this._handleInput(time, delta);
    this._updateCursor(delta);
  }

  _handleInput(_time, delta) {
    const mainScene = this._getMainScene();

    // Aggressively ignore all inputs if dev console is visible in the main scene
    if (mainScene?.devConsole?.visible) {
      // Clear previous states so we don't 'just down' as soon as it closes
      this.prevButtons.cross = true;
      this.prevButtons.circle = true;
      this.prevButtons.options = true;
      this.prevButtons.esc = true;
      return;
    }

    const pads = this.input.gamepad.gamepads;
    const cursors = this.cursors;

    // Aggregate directional input from all pads + keyboard
    let up = cursors.up.isDown;
    let down = cursors.down.isDown;
    let left = cursors.left.isDown;
    let right = cursors.right.isDown;

    let crossDown = this.keys.enter.isDown || this.keys.space.isDown;
    let circleDown = false;
    let squareDown = false;
    let optionsDown = false;
    const escDown = this.keys.esc.isDown;

    for (const pad of pads) {
      if (!pad) continue;
      up = up || pad.up || (pad.axes[1]?.getValue() ?? 0) < -0.5;
      down = down || pad.down || (pad.axes[1]?.getValue() ?? 0) > 0.5;
      left = left || pad.left || (pad.axes[0]?.getValue() ?? 0) < -0.5;
      right = right || pad.right || (pad.axes[0]?.getValue() ?? 0) > 0.5;

      crossDown = crossDown || pad.buttons[0]?.pressed;
      circleDown = circleDown || pad.buttons[1]?.pressed;
      squareDown = squareDown || pad.buttons[2]?.pressed;
      optionsDown = optionsDown || pad.buttons[9]?.pressed;
    }

    // Only process navigation if we have a menu
    if (this.menuItems.length > 0) {
      this._processDir('up', up, 0, -1, delta);
      this._processDir('down', down, 0, 1, delta);
      this._processDir('left', left, -1, 0, delta);
      this._processDir('right', right, 1, 0, delta);
    }

    // Check for 'Just Down'
    const crossJustDown = crossDown && !this.prevButtons.cross;
    const circleJustDown = circleDown && !this.prevButtons.circle;
    const optionsJustDown = optionsDown && !this.prevButtons.options;
    const escJustDown = escDown && !this.prevButtons.esc;

    // Confirm Logic - Only Cross (X) or Enter/Space
    if (crossJustDown) {
      const focused = this._getFocusedItem();
      if (focused) {
        focused.emit('pointerdown');
        focused.emit('pointerup');
      }
    }

    // Cancel / Back / Pause Logic
    if (circleJustDown || optionsJustDown || escJustDown) {
      const mainScene = this._getMainScene();
      if (mainScene) {
        // Options button on pad should toggle pause in FightScene
        if (optionsJustDown && mainScene.scene.key === 'FightScene') {
          if (typeof mainScene._togglePause === 'function') {
            mainScene._togglePause();
          }
        } else {
          if (typeof mainScene.handleBack === 'function') mainScene.handleBack();
          else if (typeof mainScene.goBack === 'function') mainScene.goBack();
          else if (typeof mainScene._goBack === 'function') mainScene._goBack();
          else {
            mainScene.events.emit('ui_cancel');
          }
        }
      }
    }

    // Update button states for next frame
    this.prevButtons.cross = crossDown;
    this.prevButtons.circle = circleDown;
    this.prevButtons.square = squareDown;
    this.prevButtons.options = optionsDown;
    this.prevButtons.esc = escDown;
  }

  _processDir(name, isPressed, dx, dy, delta) {
    if (isPressed) {
      if (this.padTimers[name] === 0) {
        this._moveCursor(dx, dy);
        this.padTimers[name] = this.NAV_DELAY;
      } else {
        this.padTimers[name] -= delta;
        if (this.padTimers[name] <= 0) {
          this._moveCursor(dx, dy);
          this.padTimers[name] = this.NAV_FREQ;
        }
      }
    } else {
      this.padTimers[name] = 0;
    }
  }

  _moveCursor(dx, dy) {
    if (this.menuItems.length === 0) return;

    const prev = this._getFocusedItem();

    if (this.isGrid) {
      const rows = this.menuItems.length;
      // Wrap vertical
      this.cursorY = (this.cursorY + dy + rows) % rows;

      const cols = this.menuItems[this.cursorY]?.length || 0;
      if (cols > 0) {
        // If we came from a wider row, clamp to the new row's width first
        if (this.cursorX >= cols) this.cursorX = cols - 1;
        // Wrap horizontal
        this.cursorX = (this.cursorX + dx + cols) % cols;
      }
    } else {
      if (dy !== 0) {
        this.cursorY += dy;
        if (this.cursorY < 0) this.cursorY = this.menuItems.length - 1;
        if (this.cursorY >= this.menuItems.length) this.cursorY = 0;
      }
    }

    const next = this._getFocusedItem();
    if (next && next !== prev) {
      if (prev) prev.emit('pointerout');
      next.emit('pointerover');
      this.game.audioManager?.play('ui_navigate');
      this.targetBounds = this._getGlobalBounds(next);
    }
  }

  _updateCursor(_delta) {
    this.graphics.clear();

    // Auto-clear menu if focused item was destroyed (prevent ghost cursors)
    const focused = this._getFocusedItem();
    if (focused && (!focused.scene || !focused.active)) {
      this.setNavMenu(null);
      return;
    }

    if (this.menuItems.length === 0 || !this.cursorVisible) return;
    if (focused?.noCursor) return;

    // Lerp bounds
    this.currentBounds.x = Phaser.Math.Linear(
      this.currentBounds.x,
      this.targetBounds.x,
      this.LERP_SPEED,
    );
    this.currentBounds.y = Phaser.Math.Linear(
      this.currentBounds.y,
      this.targetBounds.y,
      this.LERP_SPEED,
    );
    this.currentBounds.w = Phaser.Math.Linear(
      this.currentBounds.w,
      this.targetBounds.w,
      this.LERP_SPEED,
    );
    this.currentBounds.h = Phaser.Math.Linear(
      this.currentBounds.h,
      this.targetBounds.h,
      this.LERP_SPEED,
    );

    const thickness = 2;
    const padding = 2;

    this.graphics.lineStyle(thickness, 0xffcc00, 1);
    this.graphics.strokeRect(
      this.currentBounds.x - padding,
      this.currentBounds.y - padding,
      this.currentBounds.w + padding * 2,
      this.currentBounds.h + padding * 2,
    );

    this.graphics.fillStyle(0xffcc00, 0.1);
    this.graphics.fillRect(
      this.currentBounds.x - padding,
      this.currentBounds.y - padding,
      this.currentBounds.w + padding * 2,
      this.currentBounds.h + padding * 2,
    );
  }
}
