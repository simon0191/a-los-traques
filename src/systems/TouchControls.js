import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { SPECIAL_COST_FP } from './FixedPoint.js';

/**
 * Virtual gamepad overlay for touch devices.
 * Left side: invisible joystick zone for directional input.
 * Right side: five attack buttons (PL, PP, PaL, PaP, ES).
 *
 * Supports multi-touch so the player can move and attack simultaneously.
 */
export class TouchControls {
  constructor(scene, inputManager, playerIndex = 0) {
    this.scene = scene;
    this.input = inputManager;
    this.playerIndex = playerIndex;
    this.enabled = false;

    // Only enable on touch devices
    if (!scene.sys.game.device.input.touch) return;
    this.enabled = true;

    // Enable extra pointers for multi-touch (Phaser default is 2, we need up to 5)
    scene.input.addPointer(3);

    // Joystick state
    this.joystickActive = false;
    this.joystickPointerId = null; // which pointer owns the joystick
    this.joystickOrigin = { x: 0, y: 0 };
    this.deadZone = 10;

    // Visual elements
    this.joystickBase = null;
    this.joystickThumb = null;
    this.buttons = []; // { graphic, hitArea, label, key }[]
    this.activeButtonPointers = {}; // pointerId -> button key
    this.specialGlow = null;
    this.specialParticles = null;

    this.createJoystick();
    this.createButtons();
    this.setupPointerEvents();
  }

  // ---------------------------------------------------------------------------
  // Joystick
  // ---------------------------------------------------------------------------

  createJoystick() {
    const scene = this.scene;

    // Invisible hit zone covering left third of screen
    this.joystickZone = scene.add
      .rectangle(0, 0, GAME_WIDTH / 3, GAME_HEIGHT, 0x000000, 0)
      .setOrigin(0, 0)
      .setDepth(100)
      .setInteractive();

    // Base ring (shown when touching)
    this.joystickBase = scene.add.circle(0, 0, 30, 0xffffff, 0.15).setDepth(101).setVisible(false);

    this.joystickBaseRing = scene.add
      .circle(0, 0, 30, 0xffffff, 0)
      .setStrokeStyle(1.5, 0xffffff, 0.3)
      .setDepth(101)
      .setVisible(false);

    // Thumb indicator
    this.joystickThumb = scene.add.circle(0, 0, 14, 0xffffff, 0.35).setDepth(102).setVisible(false);
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------

  createButtons() {
    const scene = this.scene;
    const btnRadius = 18; // 36px diameter
    const gap = 6;

    // Anchor point for button cluster: bottom-right area
    // Moved further toward the right edge (from 70 to 45)
    const baseX = GAME_WIDTH - 45;
    const baseY = GAME_HEIGHT - 60;

    // Button definitions with positions relative to baseX/baseY
    //   Top row:           [ES]
    //   Middle row:  [LP]  [LK]
    //   Bottom row:  [HP]  [HK]
    const defs = [
      // key in touchState, label, dx, dy
      {
        key: 'special',
        label: 'ES',
        dx: 0, // Aligned with the right column
        dy: -(btnRadius * 2 + gap) * 1.4, // Higher up
      },
      { key: 'lightPunch', label: 'PL', dx: -(btnRadius * 2 + gap), dy: 0 },
      { key: 'lightKick', label: 'PaL', dx: 0, dy: 0 },
      { key: 'heavyPunch', label: 'PP', dx: -(btnRadius * 2 + gap), dy: btnRadius * 2 + gap },
      { key: 'heavyKick', label: 'PaP', dx: 0, dy: btnRadius * 2 + gap },
    ];

    for (const def of defs) {
      const cx = baseX + def.dx;
      const cy = baseY + def.dy;

      // Special button glow (behind the button)
      let glow = null;
      if (def.key === 'special') {
        glow = scene.add
          .circle(cx, cy, btnRadius + 4, 0xffcc00, 0.4)
          .setDepth(100)
          .setVisible(false);
        this.specialGlow = glow;
        
        // Particles for ES button
        this.specialParticles = scene.add.particles(cx, cy, 'white_pixel', {
          speed: { min: 10, max: 25 },
          angle: { min: 0, max: 360 },
          scale: { start: 1.2, end: 0 },
          alpha: { start: 0.6, end: 0 },
          lifespan: 500,
          frequency: 80,
          tint: 0xffcc00,
          emitting: false
        }).setDepth(100);

        // Add a pulsing tween for the glow
        scene.tweens.add({
          targets: glow,
          alpha: 0.1,
          scale: 1.1,
          duration: 600,
          yoyo: true,
          loop: -1
        });
      }

      // Button background circle
      const bg = scene.add
        .circle(cx, cy, btnRadius, 0xffffff, 0.2)
        .setStrokeStyle(1.5, 0xffffff, 0.35)
        .setDepth(101);

      // Label
      const txt = scene.add
        .text(cx, cy, def.label, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#ffffff',
          align: 'center',
        })
        .setOrigin(0.5)
        .setAlpha(0.5)
        .setDepth(102);

      this.buttons.push({
        graphic: bg,
        text: txt,
        glow: glow,
        key: def.key,
        cx,
        cy,
        radius: btnRadius,
        pressed: false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer events (unified handler for joystick + buttons)
  // ---------------------------------------------------------------------------

  setupPointerEvents() {
    const scene = this.scene;

    scene.input.on('pointerdown', (pointer) => {
      this.handlePointerDown(pointer);
    });

    scene.input.on('pointermove', (pointer) => {
      this.handlePointerMove(pointer);
    });

    scene.input.on('pointerup', (pointer) => {
      this.handlePointerUp(pointer);
    });
  }

  handlePointerDown(pointer) {
    const x = pointer.x;
    const y = pointer.y;
    const id = pointer.id;

    // Check buttons first (right side)
    const btn = this.hitTestButton(x, y);
    if (btn) {
      this.pressButton(btn, id);
      return;
    }

    // Check joystick zone (left third)
    if (x < GAME_WIDTH / 3 && !this.joystickActive) {
      this.joystickActive = true;
      this.joystickPointerId = id;
      this.joystickOrigin.x = x;
      this.joystickOrigin.y = y;

      // Show visuals at touch point
      this.joystickBase.setPosition(x, y).setVisible(true);
      this.joystickBaseRing.setPosition(x, y).setVisible(true);
      this.joystickThumb.setPosition(x, y).setVisible(true);
    }
  }

  handlePointerMove(pointer) {
    const id = pointer.id;

    // Joystick drag
    if (this.joystickActive && id === this.joystickPointerId) {
      this.updateJoystickFromPointer(pointer);
      return;
    }

    // If a pointer that was on a button moves, check if it slid to a different button
    if (this.activeButtonPointers[id] !== undefined) {
      const btn = this.hitTestButton(pointer.x, pointer.y);
      const prevKey = this.activeButtonPointers[id];
      if (!btn || btn.key !== prevKey) {
        // Released previous button
        this.releaseButtonByKey(prevKey, id);
      }
      if (btn && btn.key !== prevKey) {
        this.pressButton(btn, id);
      }
    }
  }

  handlePointerUp(pointer) {
    const id = pointer.id;

    // Joystick release
    if (this.joystickActive && id === this.joystickPointerId) {
      this.joystickActive = false;
      this.joystickPointerId = null;

      // Reset directions
      this.input.touchState.left = false;
      this.input.touchState.right = false;
      this.input.touchState.up = false;
      this.input.touchState.down = false;

      // Hide visuals
      this.joystickBase.setVisible(false);
      this.joystickBaseRing.setVisible(false);
      this.joystickThumb.setVisible(false);
      return;
    }

    // Button release
    if (this.activeButtonPointers[id] !== undefined) {
      this.releaseButtonByKey(this.activeButtonPointers[id], id);
    }
  }

  // ---------------------------------------------------------------------------
  // Joystick logic
  // ---------------------------------------------------------------------------

  updateJoystickFromPointer(pointer) {
    const dx = pointer.x - this.joystickOrigin.x;
    const dy = pointer.y - this.joystickOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Clamp thumb visual to a max radius
    const maxRadius = 28;
    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);
    const thumbX = this.joystickOrigin.x + Math.cos(angle) * clampedDist;
    const thumbY = this.joystickOrigin.y + Math.sin(angle) * clampedDist;
    this.joystickThumb.setPosition(thumbX, thumbY);

    // Reset directions
    this.input.touchState.left = false;
    this.input.touchState.right = false;
    this.input.touchState.up = false;
    this.input.touchState.down = false;

    if (dist < this.deadZone) return;

    // Determine direction using angle thresholds
    // Normalize angle to degrees for clarity
    const deg = Phaser.Math.RadToDeg(angle);

    // Horizontal
    if (deg > -67.5 && deg < 67.5) {
      this.input.touchState.right = true;
    } else if (deg > 112.5 || deg < -112.5) {
      this.input.touchState.left = true;
    }

    // Vertical
    if (deg > 22.5 && deg < 157.5) {
      this.input.touchState.down = true;
    } else if (deg < -22.5 && deg > -157.5) {
      this.input.touchState.up = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Button helpers
  // ---------------------------------------------------------------------------

  hitTestButton(x, y) {
    for (const btn of this.buttons) {
      const dx = x - btn.cx;
      const dy = y - btn.cy;
      // Slightly larger hit area than visual radius for fat-finger friendliness
      if (dx * dx + dy * dy <= (btn.radius + 6) * (btn.radius + 6)) {
        return btn;
      }
    }
    return null;
  }

  pressButton(btn, pointerId) {
    // Fire the touch state flag (one-shot: will be consumed by consumeTouch)
    this.input.touchState[btn.key] = true;

    // Track which pointer is on which button
    this.activeButtonPointers[pointerId] = btn.key;

    // Visual feedback
    btn.graphic.setAlpha(0.6);
    btn.graphic.setFillStyle(0xffffff, 0.45);
    btn.text.setAlpha(0.9);
    btn.pressed = true;
  }

  releaseButtonByKey(key, pointerId) {
    delete this.activeButtonPointers[pointerId];

    const btn = this.buttons.find((b) => b.key === key);
    if (!btn) return;

    // Check if any OTHER pointer is still pressing this button
    const stillPressed = Object.values(this.activeButtonPointers).includes(key);
    if (!stillPressed) {
      btn.graphic.setAlpha(1);
      btn.graphic.setFillStyle(0xffffff, 0.2);
      btn.text.setAlpha(0.5);
      btn.pressed = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Update (called each frame from FightScene)
  // ---------------------------------------------------------------------------

  update() {
    if (!this.enabled) return;

    // 1. Monitor special meter for glow effect
    const fighter = this.playerIndex === 0 ? this.scene.p1Fighter : this.scene.p2Fighter;
    if (fighter && this.specialGlow) {
      const isAvailable = fighter.special >= SPECIAL_COST_FP;
      this.specialGlow.setVisible(isAvailable);
      
      // Update ES button effects
      if (isAvailable) {
        this.specialParticles.emitting = true;
      } else {
        this.specialParticles.emitting = false;
      }
      
      // Also update the special button's text/border color when available
      const spBtn = this.buttons.find(b => b.key === 'special');
      if (spBtn) {
        if (isAvailable) {
          spBtn.graphic.setStrokeStyle(2, 0xffcc00, 0.8);
          spBtn.text.setColor('#ffcc00').setAlpha(1);
        } else {
          spBtn.graphic.setStrokeStyle(1.5, 0xffffff, 0.35);
          spBtn.text.setColor('#ffffff').setAlpha(0.5);
        }
      }
    }

    // 2. The joystick is driven entirely by pointer events, so nothing extra needed
    // here. But we re-check the active joystick pointer in case the event was
    // missed (e.g. pointer moved outside canvas and came back).
    if (this.joystickActive) {
      const pointer = this.getPointerById(this.joystickPointerId);
      if (pointer?.isDown) {
        this.updateJoystickFromPointer(pointer);
      } else {
        // Lost the pointer
        this.handlePointerUp({ id: this.joystickPointerId });
      }
    }
  }

  /**
   * Find a Phaser pointer by its id.
   */
  getPointerById(id) {
    const mgr = this.scene.input.manager;
    for (let i = 1; i <= mgr.pointersTotal; i++) {
      const p = this.scene.input[`pointer${i}`] || mgr.pointers[i];
      if (p && p.id === id) return p;
    }
    // Also check pointer1..pointer5 on the input plugin
    for (let i = 1; i <= 5; i++) {
      const p = this.scene.input[`pointer${i}`];
      if (p && p.id === id) return p;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy() {
    if (!this.enabled) return;

    // Remove pointer event listeners
    this.scene.input.off('pointerdown');
    this.scene.input.off('pointermove');
    this.scene.input.off('pointerup');

    // Destroy game objects
    if (this.joystickZone) this.joystickZone.destroy();
    if (this.joystickBase) this.joystickBase.destroy();
    if (this.joystickBaseRing) this.joystickBaseRing.destroy();
    if (this.joystickThumb) this.joystickThumb.destroy();
    if (this.specialParticles) this.specialParticles.destroy();

    for (const btn of this.buttons) {
      btn.graphic.destroy();
      btn.text.destroy();
      if (btn.glow) btn.glow.destroy();
    }
    this.buttons = [];
    this.activeButtonPointers = {};
  }
}
