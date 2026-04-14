/**
 * OverlayEditorScene — dev tool for calibrating per-frame accessory overlays.
 * Reachable via `?editor=1`. See RFC 0018 for the full design.
 *
 * This scene orchestrates:
 *   - Selection of fighter / animation / accessory (keyboard)
 *   - Per-frame transform editing (keyboard precision + mouse gross positioning)
 *   - Onion-skin, grid, and animation playback preview
 *   - Session save / strip export / batch export via the dev Vite endpoint
 *
 * Pure state lives in OverlaySession (testable, in src/editor/). This scene is
 * just the rendering and input glue.
 */
import Phaser from 'phaser';
import { FIGHTER_HEIGHT, FIGHTER_WIDTH, GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { exportOverlayStrip } from '../editor/OverlayExporter.js';
import { OverlaySession } from '../editor/OverlaySession.js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('OverlayEditor');

const ANIM_DEFS = {
  idle: 4,
  walk: 4,
  light_punch: 4,
  heavy_punch: 5,
  light_kick: 4,
  heavy_kick: 5,
  special: 5,
  block: 2,
  hurt: 3,
  knockdown: 4,
  victory: 4,
  defeat: 3,
  jump: 3,
};
const ANIM_NAMES = Object.keys(ANIM_DEFS);

// Must match BootScene's FIGHTERS_WITH_SPRITES.
const FIGHTERS_WITH_SPRITES = [
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
];

// MVP (RFC 0018): ship with the hat first; other accessories added as their
// art lands. The editor is catalog-driven so adding items is a one-line change.
const ACCESSORY_IDS = ['sombrero_catalina'];

const ZOOM = 1.5;
const PREVIEW_CX = GAME_WIDTH / 2;
const PREVIEW_CY = 115;
const PREVIEW_SIZE = FIGHTER_WIDTH * ZOOM; // 192
const PREVIEW_LEFT = PREVIEW_CX - PREVIEW_SIZE / 2;
const PREVIEW_TOP = PREVIEW_CY - PREVIEW_SIZE / 2;

const CANVAS_TO_FRAME = 1 / ZOOM;

const DEV_EXPORT_URL = '/dev/overlay-export';

export class OverlayEditorScene extends Phaser.Scene {
  constructor() {
    super('OverlayEditorScene');
  }

  create() {
    this.fighterIdx = 0;
    this.animIdx = 0; // idle
    this.accessoryIdx = 0;
    this.frameIdx = 0;
    this.session = null; // current OverlaySession
    this.onionSkin = false;
    this.showGrid = false;
    this.playing = false;
    this._playFrameTimer = 0;
    this._dragStart = null; // { x, y, frameCx, frameCy, rotation }
    this._dragMode = null; // 'translate' | 'rotate'

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0f0f1a);

    // Preview frame backdrop
    this.add
      .rectangle(PREVIEW_CX, PREVIEW_CY, PREVIEW_SIZE, PREVIEW_SIZE, 0x202035)
      .setStrokeStyle(1, 0x4444aa);

    this.fighterSprite = this.add
      .sprite(PREVIEW_CX, PREVIEW_CY, '__DEFAULT')
      .setOrigin(0.5, 0.5)
      .setDisplaySize(PREVIEW_SIZE, PREVIEW_SIZE)
      .setDepth(1);

    this.onionSprite = this.add
      .sprite(PREVIEW_CX, PREVIEW_CY, '__DEFAULT')
      .setOrigin(0.5, 0.5)
      .setDisplaySize(PREVIEW_SIZE, PREVIEW_SIZE)
      .setAlpha(0.3)
      .setVisible(false)
      .setDepth(0);

    this.overlaySprite = this.add
      .sprite(PREVIEW_CX, PREVIEW_CY, '__DEFAULT')
      .setOrigin(0.5, 0.5)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .setDepth(2);

    // Grid (hidden until G)
    this.grid = this.add.graphics().setDepth(3);
    this._drawGrid();
    this.grid.setVisible(false);

    // Context bars
    this.contextLine1 = this._addText(5, 5, '', 10, '#ffcc00');
    this.contextLine2 = this._addText(5, 17, '', 10, '#aaffcc');

    // Timeline
    this.timelineGfx = this.add.graphics().setDepth(4);

    // Shortcut help
    this._addText(
      5,
      GAME_HEIGHT - 30,
      'Mouse:drag=move  Shift+drag=rot  Ctrl+wheel=scale',
      8,
      '#888899',
    );
    this._addText(
      5,
      GAME_HEIGHT - 19,
      'HJKL move  QE rot  -/= scale  C copy F kf I interp R reset  Ctrl+Z undo',
      8,
      '#888899',
    );
    this._addText(
      5,
      GAME_HEIGHT - 9,
      'WS fighter  \u2191\u2193 anim  AD acc  \u2190\u2192 frame  Space play  Ctrl+S save  Ctrl+E export',
      8,
      '#888899',
    );

    // Status line (top-right)
    this.statusText = this._addText(GAME_WIDTH - 5, 5, '', 9, '#66ccff').setOrigin(1, 0);

    // Keyboard
    this._setupKeyboard();

    // Mouse
    this._setupMouse();

    // Initialize session
    this._loadOrCreateSession();
  }

  update(_t, dt) {
    if (this.playing) {
      this._playFrameTimer += dt;
      const fps = 8; // editor preview speed
      if (this._playFrameTimer >= 1000 / fps) {
        this._playFrameTimer = 0;
        this.frameIdx = (this.frameIdx + 1) % this.session.frameCount;
        this._render();
      }
    }
  }

  // --- Setup helpers ---

  _addText(x, y, content, size = 10, color = '#ffffff') {
    return this.add.text(x, y, content, {
      fontFamily: 'monospace',
      fontSize: `${size}px`,
      color,
    });
  }

  _setupKeyboard() {
    const kb = this.input.keyboard;

    // Stop the browser from stealing our Ctrl+S (save page), Ctrl+E (find in
    // Firefox / focus URL bar), Ctrl+Shift+E, Ctrl+Z/Y, Ctrl+-/= etc. Phaser's
    // own event loop runs after these are dispatched, so we need a window-level
    // capture to call preventDefault before the browser acts.
    this._globalKeyHandler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const captured = ['s', 'e', 'z', 'y', '-', '=', '+'];
      if (captured.includes(e.key.toLowerCase())) {
        e.preventDefault();
        // Route Ctrl-combos directly from the window listener so they work
        // regardless of whether Phaser also sees the keydown. Phaser's keyboard
        // plugin in some builds doesn't dispatch modified keys reliably.
        if (e.key.toLowerCase() === 's') this._saveSession();
        else if (e.key.toLowerCase() === 'e') {
          if (e.shiftKey) this._batchExport();
          else this._exportStrip();
        } else if (e.key.toLowerCase() === 'z') {
          if (e.shiftKey) this._redo();
          else this._undo();
        } else if (e.key.toLowerCase() === 'y') this._redo();
        else if (e.key === '-') this._applyDelta({ scale: -0.02 });
        else if (e.key === '=' || e.key === '+') this._applyDelta({ scale: 0.02 });
      }
    };
    window.addEventListener('keydown', this._globalKeyHandler, { capture: true });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this._globalKeyHandler, { capture: true });
    });

    // Also block the Space/Tab default scrolling inside the canvas.
    kb.addCapture('SPACE,TAB');

    // Navigation
    kb.on('keydown-W', () => this._cycleFighter(-1));
    kb.on('keydown-S', (e) => {
      // Ctrl+S is handled by the window-level listener above; guard here too.
      if (e.ctrlKey || e.metaKey) return;
      this._cycleFighter(1);
    });
    kb.on('keydown-UP', () => this._cycleAnim(-1));
    kb.on('keydown-DOWN', () => this._cycleAnim(1));
    kb.on('keydown-A', () => this._cycleAccessory(-1));
    kb.on('keydown-D', () => this._cycleAccessory(1));
    kb.on('keydown-LEFT', () => this._cycleFrame(-1));
    kb.on('keydown-RIGHT', () => this._cycleFrame(1));

    // Transform nudges
    const step = (key, dx, dy) => {
      kb.on(`keydown-${key}`, (e) => {
        const mult = e.shiftKey ? 10 : 1;
        this._applyDelta({ x: dx * mult, y: dy * mult });
      });
    };
    step('H', -1, 0);
    step('J', 0, 1);
    step('K', 0, -1);
    step('L', 1, 0);

    // Rotate (Q/E)
    kb.on('keydown-Q', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const mult = e.shiftKey ? 5 : 1;
      this._applyDelta({ rotation: -(Math.PI / 180) * mult });
    });
    kb.on('keydown-E', (e) => {
      if (e.ctrlKey || e.metaKey) return; // Ctrl+E is export, handled by window
      const mult = e.shiftKey ? 5 : 1;
      this._applyDelta({ rotation: (Math.PI / 180) * mult });
    });

    // Scale (-/=) with Shift for 5x. Ctrl+-/Ctrl+= is aliased via window handler.
    kb.on('keydown-MINUS', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const base = 0.02;
      const mult = e.shiftKey ? 5 : 1;
      this._applyDelta({ scale: -base * mult });
    });
    kb.on('keydown-EQUAL', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const base = 0.02;
      const mult = e.shiftKey ? 5 : 1;
      this._applyDelta({ scale: base * mult });
    });

    // Copy / keyframe / interp / reset
    kb.on('keydown-C', () => this._copyFromPrev());
    kb.on('keydown-V', () => this._copyToNext());
    kb.on('keydown-F', () => this._toggleKeyframe());
    kb.on('keydown-I', () => this._interpolate());
    kb.on('keydown-R', () => this._resetFrame());

    // Ctrl+Z, Ctrl+Y, Ctrl+E, Ctrl+Shift+E are all handled by the window-level
    // capture listener (which also preventDefault's the browser shortcuts).

    // Toggles
    kb.on('keydown-TAB', (e) => {
      e.preventDefault?.();
      this.onionSkin = !this.onionSkin;
      this._render();
    });
    kb.on('keydown-G', () => {
      this.showGrid = !this.showGrid;
      this.grid.setVisible(this.showGrid);
    });
    kb.on('keydown-SPACE', () => {
      this.playing = !this.playing;
      this._playFrameTimer = 0;
      this._setStatus(this.playing ? 'playing' : '');
    });
    kb.on('keydown-ESC', () => this.scene.start('TitleScene'));
  }

  _setupMouse() {
    const withinPreview = (x, y) =>
      x >= PREVIEW_LEFT &&
      x <= PREVIEW_LEFT + PREVIEW_SIZE &&
      y >= PREVIEW_TOP &&
      y <= PREVIEW_TOP + PREVIEW_SIZE;

    this.overlaySprite.on('pointerdown', (pointer) => {
      if (!this.session) return;
      const frame = this.session.frames[this.frameIdx];
      if (pointer.event?.shiftKey) {
        this._dragMode = 'rotate';
        this._dragStart = {
          screenX: pointer.x,
          screenY: pointer.y,
          startRotation: frame.rotation,
          cxScreen: this._frameToScreenX(frame.x),
          cyScreen: this._frameToScreenY(frame.y),
        };
      } else {
        this._dragMode = 'translate';
        this._dragStart = {
          screenX: pointer.x,
          screenY: pointer.y,
          startX: frame.x,
          startY: frame.y,
        };
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (!this._dragMode || !this._dragStart) return;
      if (this._dragMode === 'translate') {
        const dx = (pointer.x - this._dragStart.screenX) * CANVAS_TO_FRAME;
        const dy = (pointer.y - this._dragStart.screenY) * CANVAS_TO_FRAME;
        this.session.setTransform(this.frameIdx, {
          ...this.session.frames[this.frameIdx],
          x: this._dragStart.startX + dx,
          y: this._dragStart.startY + dy,
        });
        this._render();
      } else if (this._dragMode === 'rotate') {
        const a0 = Math.atan2(
          this._dragStart.screenY - this._dragStart.cyScreen,
          this._dragStart.screenX - this._dragStart.cxScreen,
        );
        const a1 = Math.atan2(
          pointer.y - this._dragStart.cyScreen,
          pointer.x - this._dragStart.cxScreen,
        );
        this.session.setTransform(this.frameIdx, {
          ...this.session.frames[this.frameIdx],
          rotation: this._dragStart.startRotation + (a1 - a0),
        });
        this._render();
      }
    });

    this.input.on('pointerup', () => {
      this._dragMode = null;
      this._dragStart = null;
    });

    // Wheel = Ctrl+wheel scale / plain wheel ignored
    this.input.on('wheel', (_pointer, _go, _dx, dy, _dz, event) => {
      if (!event?.ctrlKey) return;
      if (!withinPreview(this.input.x, this.input.y)) return;
      event.preventDefault?.();
      const step = event.shiftKey ? 0.1 : 0.02;
      const delta = dy > 0 ? -step : step;
      this._applyDelta({ scale: delta });
    });
  }

  // --- Session lifecycle ---

  _sessionPath() {
    const fighter = FIGHTERS_WITH_SPRITES[this.fighterIdx];
    const accessory = ACCESSORY_IDS[this.accessoryIdx];
    const anim = ANIM_NAMES[this.animIdx];
    return `assets/overlay-editor/sessions/${fighter}/${accessory}_${anim}.json`;
  }

  _stripPath() {
    const fighter = FIGHTERS_WITH_SPRITES[this.fighterIdx];
    const accessory = ACCESSORY_IDS[this.accessoryIdx];
    const anim = ANIM_NAMES[this.animIdx];
    return `public/assets/overlays/${fighter}/${accessory}_${anim}.png`;
  }

  async _loadOrCreateSession() {
    const fighter = FIGHTERS_WITH_SPRITES[this.fighterIdx];
    const accessory = ACCESSORY_IDS[this.accessoryIdx];
    const anim = ANIM_NAMES[this.animIdx];
    const frameCount = ANIM_DEFS[anim];

    // Attempt to GET a saved session via the dev server
    let loaded = null;
    try {
      const res = await fetch(`${DEV_EXPORT_URL}?path=${encodeURIComponent(this._sessionPath())}`);
      if (res.ok) {
        const body = await res.json();
        loaded = OverlaySession.fromJSON(body);
      }
    } catch (e) {
      log.debug('session load failed', { err: e.message });
    }

    this.session =
      loaded ??
      new OverlaySession({
        fighterId: fighter,
        accessoryId: accessory,
        animation: anim,
        frameCount,
        sourceStrip: `assets/fighters/${fighter}/${anim}.png`,
        accessoryImage: `assets/accessories/${accessory}.png`,
      });

    this.frameIdx = 0;
    this._render();
  }

  async _saveSession() {
    if (!this.session) return;
    console.log('[OverlayEditor] save', this._sessionPath());
    this._setStatus('saving...');
    try {
      const res = await fetch(DEV_EXPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this._sessionPath(), json: this.session.toJSON() }),
      });
      const contentType = res.headers.get('content-type') || '';
      console.log('[OverlayEditor] save response', { status: res.status, contentType });
      if (res.ok) {
        this._setStatus('session saved');
      } else if (contentType.includes('text/html')) {
        // Vite SPA fallback — plugin not loaded. Warn explicitly.
        this._setStatus('plugin not loaded (restart vite)');
      } else {
        this._setStatus(`save failed: ${res.status}`);
      }
    } catch (e) {
      console.warn('[OverlayEditor] save failed', e.message);
      this._downloadBlob(
        new Blob([JSON.stringify(this.session.toJSON(), null, 2)], { type: 'application/json' }),
        `${this.session.fighterId}_${this.session.accessoryId}_${this.session.animation}.json`,
      );
      this._setStatus('session downloaded (no dev server)');
    }
  }

  async _exportStrip() {
    if (!this.session) return;
    const accTextureKey = `accessory_${this.session.accessoryId}`;
    if (!this.textures.exists(accTextureKey)) {
      this._setStatus('accessory texture missing');
      return;
    }
    const sourceCanvas = this.textures.get(accTextureKey).getSourceImage();
    const canvas = exportOverlayStrip({
      session: this.session,
      accessoryImage: sourceCanvas,
      frameWidth: FIGHTER_WIDTH,
      frameHeight: FIGHTER_HEIGHT,
      createCanvas: (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      },
    });
    await this._persistStrip(canvas);
  }

  async _batchExport() {
    // v1: iterate all fighter × accessory × anim triples and export any with a saved session.
    this._setStatus('batch exporting...');
    let count = 0;
    const origFighter = this.fighterIdx;
    const origAcc = this.accessoryIdx;
    const origAnim = this.animIdx;
    for (let f = 0; f < FIGHTERS_WITH_SPRITES.length; f++) {
      for (let a = 0; a < ACCESSORY_IDS.length; a++) {
        for (let n = 0; n < ANIM_NAMES.length; n++) {
          this.fighterIdx = f;
          this.accessoryIdx = a;
          this.animIdx = n;
          try {
            const res = await fetch(
              `${DEV_EXPORT_URL}?path=${encodeURIComponent(this._sessionPath())}`,
            );
            if (!res.ok) continue;
            const json = await res.json();
            this.session = OverlaySession.fromJSON(json);
            await this._exportStrip();
            count++;
          } catch (e) {
            log.warn('batch export step failed', { err: e.message });
          }
        }
      }
    }
    this.fighterIdx = origFighter;
    this.accessoryIdx = origAcc;
    this.animIdx = origAnim;
    await this._loadOrCreateSession();
    this._setStatus(`batch exported ${count} strips`);
  }

  async _persistStrip(canvas) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      this._setStatus('canvas.toBlob returned null');
      return;
    }
    const base64 = await this._blobToBase64(blob);
    try {
      const res = await fetch(DEV_EXPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this._stripPath(), base64 }),
      });
      if (res.ok) {
        this._setStatus('strip saved');
      } else {
        this._setStatus(`export failed: ${res.status}`);
      }
    } catch (_e) {
      this._downloadBlob(
        blob,
        `${this.session.fighterId}_${this.session.accessoryId}_${this.session.animation}.png`,
      );
      this._setStatus('strip downloaded (no dev server)');
    }
  }

  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const s = reader.result;
        resolve(s.substring(s.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Editing actions ---

  _applyDelta(delta) {
    if (!this.session) return;
    this.session.applyTransform(this.frameIdx, delta);
    this._render();
  }

  _copyFromPrev() {
    if (!this.session) return;
    this.session.copyFromPrev(this.frameIdx);
    this._render();
  }

  _copyToNext() {
    if (!this.session) return;
    if (this.frameIdx + 1 >= this.session.frameCount) return;
    this.session.setTransform(this.frameIdx + 1, this.session.frames[this.frameIdx]);
    this._render();
  }

  _interpolate() {
    if (!this.session) return;
    if (this.session.keyframes.length === 0) {
      this._setStatus('no keyframes yet (press F to mark)');
      return;
    }
    this.session.interpolate();
    this._render();
    this._setStatus(`interpolated ${this.session.keyframes.length} keyframes`);
  }

  _toggleKeyframe() {
    if (!this.session) return;
    const wasKF = this.session.keyframes.includes(this.frameIdx);
    this.session.toggleKeyframe(this.frameIdx);
    this._render();
    this._setStatus(
      wasKF ? `frame ${this.frameIdx + 1} cleared` : `frame ${this.frameIdx + 1} keyframed`,
    );
  }

  _resetFrame() {
    if (!this.session) return;
    this.session.resetFrame(this.frameIdx);
    this._render();
  }

  _undo() {
    if (!this.session) return;
    this.session.undo();
    this._render();
  }

  _redo() {
    if (!this.session) return;
    this.session.redo();
    this._render();
  }

  // --- Navigation ---

  _cycleFighter(delta) {
    this.fighterIdx = this._wrap(this.fighterIdx + delta, FIGHTERS_WITH_SPRITES.length);
    this._loadOrCreateSession();
  }

  _cycleAnim(delta) {
    this.animIdx = this._wrap(this.animIdx + delta, ANIM_NAMES.length);
    this._loadOrCreateSession();
  }

  _cycleAccessory(delta) {
    this.accessoryIdx = this._wrap(this.accessoryIdx + delta, ACCESSORY_IDS.length);
    this._loadOrCreateSession();
  }

  _cycleFrame(delta) {
    if (!this.session) return;
    this.frameIdx = this._wrap(this.frameIdx + delta, this.session.frameCount);
    this._render();
  }

  _wrap(i, n) {
    return ((i % n) + n) % n;
  }

  // --- Rendering ---

  _render() {
    if (!this.session) return;
    const fighter = FIGHTERS_WITH_SPRITES[this.fighterIdx];
    const accessory = ACCESSORY_IDS[this.accessoryIdx];
    const anim = ANIM_NAMES[this.animIdx];
    const frame = this.session.frames[this.frameIdx];
    const isKF = this.session.keyframes.includes(this.frameIdx);

    // Fighter preview frame
    const fighterKey = `fighter_${fighter}_${anim}`;
    if (this.textures.exists(fighterKey)) {
      this.fighterSprite.setTexture(fighterKey, this.frameIdx);
      this.fighterSprite.setDisplaySize(PREVIEW_SIZE, PREVIEW_SIZE);
    } else {
      this.fighterSprite.setTexture('__DEFAULT');
    }

    // Onion skin (previous frame)
    if (this.onionSkin && this.frameIdx > 0 && this.textures.exists(fighterKey)) {
      this.onionSprite.setTexture(fighterKey, this.frameIdx - 1);
      this.onionSprite.setDisplaySize(PREVIEW_SIZE, PREVIEW_SIZE);
      this.onionSprite.setVisible(true);
    } else {
      this.onionSprite.setVisible(false);
    }

    // Accessory overlay
    const accKey = `accessory_${accessory}`;
    if (this.textures.exists(accKey)) {
      this.overlaySprite.setTexture(accKey);
      const src = this.textures.get(accKey).getSourceImage();
      const sizePx = FIGHTER_HEIGHT * frame.scale * ZOOM;
      this.overlaySprite.setDisplaySize(sizePx, sizePx * (src.height / src.width));
      this.overlaySprite.setPosition(this._frameToScreenX(frame.x), this._frameToScreenY(frame.y));
      this.overlaySprite.setRotation(frame.rotation);
      this.overlaySprite.setVisible(true);
    } else {
      this.overlaySprite.setVisible(false);
    }

    // Context bars
    this.contextLine1.setText(
      `FIGHTER:${fighter}  ANIM:${anim}  ACC:${accessory}  FRAME ${this.frameIdx + 1}/${this.session.frameCount}${isKF ? ' [K]' : ''}`,
    );
    this.contextLine2.setText(
      `x:${frame.x.toFixed(1)} y:${frame.y.toFixed(1)} r:${frame.rotation.toFixed(3)} s:${frame.scale.toFixed(2)}  onion:${this.onionSkin ? 'on' : 'off'}  grid:${this.showGrid ? 'on' : 'off'}`,
    );

    // Timeline
    this._drawTimeline();
  }

  _frameToScreenX(fx) {
    return PREVIEW_LEFT + fx * ZOOM;
  }
  _frameToScreenY(fy) {
    return PREVIEW_TOP + fy * ZOOM;
  }

  _drawGrid() {
    this.grid.clear();
    this.grid.lineStyle(1, 0x446688, 0.3);
    const step = 16 * ZOOM;
    for (let x = PREVIEW_LEFT; x <= PREVIEW_LEFT + PREVIEW_SIZE; x += step) {
      this.grid.lineBetween(x, PREVIEW_TOP, x, PREVIEW_TOP + PREVIEW_SIZE);
    }
    for (let y = PREVIEW_TOP; y <= PREVIEW_TOP + PREVIEW_SIZE; y += step) {
      this.grid.lineBetween(PREVIEW_LEFT, y, PREVIEW_LEFT + PREVIEW_SIZE, y);
    }
  }

  _drawTimeline() {
    this.timelineGfx.clear();
    if (!this.session) return;
    const startX = GAME_WIDTH / 2 - (this.session.frameCount * 12) / 2;
    const y = PREVIEW_CY + PREVIEW_SIZE / 2 + 12;
    for (let i = 0; i < this.session.frameCount; i++) {
      const cx = startX + i * 12;
      const isKF = this.session.keyframes.includes(i);
      const isCurrent = i === this.frameIdx;
      const fill = isKF ? 0xffcc00 : 0x8888aa;
      this.timelineGfx.fillStyle(fill, 1);
      this.timelineGfx.fillCircle(cx, y, 4);
      if (isCurrent) {
        this.timelineGfx.lineStyle(2, 0x66ccff, 1);
        this.timelineGfx.strokeCircle(cx, y, 6);
      }
    }
  }

  _setStatus(text) {
    this.statusText.setText(text);
    if (text) {
      this.time.delayedCall(2500, () => {
        if (this.statusText.text === text) this.statusText.setText('');
      });
    }
  }
}
