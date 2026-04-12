import Phaser from 'phaser';
import { GAME_WIDTH } from '../config.js';

export class ControllerScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ControllerScene', active: true });
    this.padTimers = { up: 0, down: 0, left: 0, right: 0 };
    this.NAV_DELAY = 300;
    this.NAV_FREQ = 150;
    this.lastConfirm = 0;
    this.lastCancel = 0;
  }

  create() {
    // Listen for gamepad connections
    this.input.gamepad.on('connected', (pad) => {
      console.log('Gamepad connected:', pad.id);
      this.showToast('Control conectado');
    });

    this.input.gamepad.on('disconnected', (pad) => {
      console.log('Gamepad disconnected:', pad.id);
      this.showToast('Control desconectado');
    });
  }

  showToast(message) {
    if (this.toastContainer) {
      this.toastContainer.destroy();
    }

    this.toastContainer = this.add.container(GAME_WIDTH / 2, -30).setDepth(9999);

    const bg = this.add.rectangle(0, 0, 160, 24, 0x000000, 0.8).setStrokeStyle(1, 0x44cc88);
    const text = this.add
      .text(0, 0, message, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#44cc88',
      })
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
    if (this.input.gamepad.total === 0) return;

    const pad = this.input.gamepad.gamepads[0];
    if (!pad) return;

    // Map axes/dpad to navigation events
    const up = pad.up || (pad.axes[1] && pad.axes[1].getValue() < -0.5);
    const down = pad.down || (pad.axes[1] && pad.axes[1].getValue() > 0.5);
    const left = pad.left || (pad.axes[0] && pad.axes[0].getValue() < -0.5);
    const right = pad.right || (pad.axes[0] && pad.axes[0].getValue() > 0.5);

    this._handleAxis('up', up, delta);
    this._handleAxis('down', down, delta);
    this._handleAxis('left', left, delta);
    this._handleAxis('right', right, delta);

    // Map Cross (Button 0) to confirm
    if (pad.buttons[0]?.pressed) {
      if (time - this.lastConfirm > 250) {
        this.game.events.emit('ui_confirm');
        this.lastConfirm = time;
      }
    }

    // Map Circle (Button 1) or Options (Button 9) to cancel/back
    if (pad.buttons[1]?.pressed || pad.buttons[9]?.pressed) {
      if (time - this.lastCancel > 250) {
        this.game.events.emit('ui_cancel');
        this.lastCancel = time;
      }
    }
  }

  _handleAxis(dir, isPressed, delta) {
    if (isPressed) {
      if (this.padTimers[dir] === 0) {
        this.game.events.emit(`ui_${dir}`);
        this.padTimers[dir] = this.NAV_DELAY;
      } else {
        this.padTimers[dir] -= delta;
        if (this.padTimers[dir] <= 0) {
          this.game.events.emit(`ui_${dir}`);
          this.padTimers[dir] = this.NAV_FREQ;
        }
      }
    } else {
      this.padTimers[dir] = 0;
    }
  }
}
