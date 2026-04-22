/**
 * OverlayEditorScene — dev tool for calibrating per-frame accessory overlays.
 * Reachable via `?editor=1`. See RFC 0018 for the full design.
 *
 * v2 (this file): consolidated `manifest.json` replaces per-combo session
 * files; UI chrome is DOM (`EditorUI`), the Phaser canvas shows only the
 * preview (fighter + overlay sprite).
 */
import Phaser from 'phaser';
import { FIGHTER_HEIGHT, FIGHTER_WIDTH, GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import accessoryCatalog from '../data/accessories.json';
import { ANIM_DEFS, ANIM_NAMES, FIGHTERS_WITH_SPRITES } from '../data/animations.js';
import { EditorUI } from '../editor/EditorUI.js';
import { overlayBaseWidth } from '../editor/math.js';
import { MANIFEST_PATH, OverlayManifest } from '../editor/OverlayManifest.js';
import { DEFAULT_TRANSFORM, OverlaySession } from '../editor/OverlaySession.js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('OverlayEditor');

// Accessory catalog is the single source of truth (src/data/accessories.json).
// Each accessory has a `category` — calibrations are shared per category so
// two different hats on the same fighter inherit the same placement.
const ACCESSORIES = accessoryCatalog.map((a) => ({
  id: a.id,
  category: a.category,
  label: a.label,
  imageUrl: a.image,
}));

const ZOOM = 2;
const PREVIEW_CX = GAME_WIDTH / 2;
const PREVIEW_CY = GAME_HEIGHT / 2 + 10;
const PREVIEW_SIZE = FIGHTER_WIDTH * ZOOM;
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
    this.animIdx = 0;
    this.accessoryIdx = 0;
    this.frameIdx = 0;
    this.session = null;
    this.manifest = new OverlayManifest();
    this.onionSkin = false;
    this.playing = false;
    this._playFrameTimer = 0;
    this._dragStart = null;
    this._dragMode = null;
    this._sessionDirty = false;
    // Snapshot of frames as loaded from manifest — used to compute the delta
    // when propagating calibration offsets across all animations.
    this._loadedFrames = null;

    // Dark background behind preview (DOM panels cover the rest).
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0f0f1a);
    this.add
      .rectangle(PREVIEW_CX, PREVIEW_CY, PREVIEW_SIZE, PREVIEW_SIZE, 0x202035)
      .setStrokeStyle(1, 0x4466aa);

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

    this._buildUI();
    this._setupKeyboard();
    this._setupMouse();
    this._loadManifest().then(() => this._syncSessionFromManifest());
  }

  update(_t, dt) {
    if (this.playing && this.session) {
      this._playFrameTimer += dt;
      const fps = 8;
      if (this._playFrameTimer >= 1000 / fps) {
        this._playFrameTimer = 0;
        this.frameIdx = (this.frameIdx + 1) % this.session.frameCount;
        this._render();
      }
    }
  }

  // --- UI wiring ---

  _buildUI() {
    this.ui = new EditorUI({
      fighters: FIGHTERS_WITH_SPRITES,
      animations: ANIM_NAMES,
      accessories: ACCESSORIES,
      handlers: {
        onFighter: (id) => {
          this._flushSessionToManifest();
          this.fighterIdx = FIGHTERS_WITH_SPRITES.indexOf(id);
          this._syncSessionFromManifest();
        },
        onAnim: (name) => {
          this._flushSessionToManifest();
          this.animIdx = ANIM_NAMES.indexOf(name);
          this._syncSessionFromManifest();
        },
        onAccessory: (id) => {
          this._flushSessionToManifest();
          this.accessoryIdx = ACCESSORIES.findIndex((a) => a.id === id);
          this._syncSessionFromManifest();
        },
        onFrame: (i) => {
          this.frameIdx = i;
          this._render();
        },
        onAction: (action) => this._handleAction(action),
      },
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.ui?.destroy());
  }

  _handleAction(action) {
    const step = 1;
    const rot = Math.PI / 180;
    const scl = 0.02;
    switch (action) {
      case 'move-left':
        return this._applyDelta({ x: -step });
      case 'move-right':
        return this._applyDelta({ x: step });
      case 'move-up':
        return this._applyDelta({ y: -step });
      case 'move-down':
        return this._applyDelta({ y: step });
      case 'rotate-ccw':
        return this._applyDelta({ rotation: -rot });
      case 'rotate-cw':
        return this._applyDelta({ rotation: rot });
      case 'scale-down':
        return this._applyDelta({ scale: -scl });
      case 'scale-up':
        return this._applyDelta({ scale: scl });
      case 'undo':
        return this._undo();
      case 'redo':
        return this._redo();
      case 'keyframe':
        return this._toggleKeyframe();
      case 'interpolate':
        return this._interpolate();
      case 'fill-frames':
        return this._fillAllFrames();
      case 'propagate-offset':
        return this._propagateOffset();
      case 'save':
        return this._saveManifest();
      default:
        log.warn('unknown action', { action });
        this.ui?.setStatus(`acción desconocida: ${action}`);
    }
  }

  // --- Keyboard ---

  _setupKeyboard() {
    const kb = this.input.keyboard;
    this._globalKeyHandler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      const captured = ['s', 'z', 'y', '-', '=', '+'];
      if (!captured.includes(key)) return;
      e.preventDefault();
      if (key === 's') this._saveManifest();
      else if (key === 'z') e.shiftKey ? this._redo() : this._undo();
      else if (key === 'y') this._redo();
      else if (key === '-') this._applyDelta({ scale: -0.02 });
      else if (key === '=' || key === '+') this._applyDelta({ scale: 0.02 });
    };
    window.addEventListener('keydown', this._globalKeyHandler, { capture: true });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this._globalKeyHandler, { capture: true });
    });

    kb.addCapture('SPACE,TAB,UP,DOWN,LEFT,RIGHT');

    kb.on('keydown-LEFT', () => this._cycleFrame(-1));
    kb.on('keydown-RIGHT', () => this._cycleFrame(1));
    kb.on('keydown-UP', () => this._cycleAnim(-1));
    kb.on('keydown-DOWN', () => this._cycleAnim(1));

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

    kb.on('keydown-Q', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const mult = e.shiftKey ? 5 : 1;
      this._applyDelta({ rotation: -(Math.PI / 180) * mult });
    });
    kb.on('keydown-E', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const mult = e.shiftKey ? 5 : 1;
      this._applyDelta({ rotation: (Math.PI / 180) * mult });
    });
    kb.on('keydown-MINUS', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const mult = e.shiftKey ? 5 : 1;
      this._applyDelta({ scale: -0.02 * mult });
    });
    kb.on('keydown-EQUAL', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const mult = e.shiftKey ? 5 : 1;
      this._applyDelta({ scale: 0.02 * mult });
    });
    kb.on('keydown-F', () => this._toggleKeyframe());
    kb.on('keydown-I', () => this._interpolate());
    kb.on('keydown-R', () => this._resetFrame());
    kb.on('keydown-P', () => this._propagateOffset());
    kb.on('keydown-C', () => this._copyFromPrev());
    kb.on('keydown-V', () => this._copyToNext());
    kb.on('keydown-TAB', (e) => {
      e.preventDefault?.();
      this.onionSkin = !this.onionSkin;
      this._render();
    });
    kb.on('keydown-SPACE', () => {
      this.playing = !this.playing;
      this._playFrameTimer = 0;
      this.ui.setStatus(this.playing ? 'playing' : '');
    });
    kb.on('keydown-ESC', () => this.scene.start('TitleScene'));
  }

  // --- Mouse ---

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
      if (!this._dragMode || !this._dragStart || !this.session) return;
      if (this._dragMode === 'translate') {
        const dx = (pointer.x - this._dragStart.screenX) * CANVAS_TO_FRAME;
        const dy = (pointer.y - this._dragStart.screenY) * CANVAS_TO_FRAME;
        this.session.setTransform(this.frameIdx, {
          ...this.session.frames[this.frameIdx],
          x: this._dragStart.startX + dx,
          y: this._dragStart.startY + dy,
        });
        this._markDirty();
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
        this._markDirty();
        this._render();
      }
    });
    this.input.on('pointerup', () => {
      this._dragMode = null;
      this._dragStart = null;
    });

    this.input.on('wheel', (_p, _g, _dx, dy, _dz, event) => {
      if (!event?.ctrlKey) return;
      if (!withinPreview(this.input.x, this.input.y)) return;
      event.preventDefault?.();
      const s = event.shiftKey ? 0.1 : 0.02;
      this._applyDelta({ scale: dy > 0 ? -s : s });
    });
  }

  // --- Manifest ↔ session ---

  _fighter() {
    return FIGHTERS_WITH_SPRITES[this.fighterIdx];
  }
  _anim() {
    return ANIM_NAMES[this.animIdx];
  }
  // Calibration key — shared across all accessories of the same category.
  _category() {
    return ACCESSORIES[this.accessoryIdx].category;
  }
  // Specific accessory id — used for preview art and strip filename.
  _accessoryId() {
    return ACCESSORIES[this.accessoryIdx].id;
  }

  async _loadManifest() {
    try {
      const res = await fetch(`${DEV_EXPORT_URL}?path=${encodeURIComponent(MANIFEST_PATH)}`);
      if (res.ok) {
        const json = await res.json();
        this.manifest = OverlayManifest.fromJSON(json);
        log.info('manifest loaded', { size: Object.keys(this.manifest.calibrations).length });
        return;
      }
      if (res.status === 404) {
        log.info('no manifest yet, starting empty');
      } else {
        log.warn('manifest load failed', { status: res.status });
      }
    } catch (e) {
      log.warn('manifest fetch error', { err: e.message });
    }
    this.manifest = new OverlayManifest();
  }

  _syncSessionFromManifest() {
    const fighter = this._fighter();
    const category = this._category();
    const accessoryId = this._accessoryId();
    const anim = this._anim();
    const frameCount = ANIM_DEFS[anim].frames;
    const entry = this.manifest.get(fighter, category, anim);
    let frames = entry?.frames ?? null;
    // If this combo isn't calibrated yet, inherit the shared scale from any
    // sibling anim so scale stays uniform per (fighter, category).
    if (!frames) {
      const sharedScale = this._sharedScale(fighter, category);
      if (sharedScale !== null) {
        frames = Array.from({ length: frameCount }, () => ({
          ...DEFAULT_TRANSFORM,
          scale: sharedScale,
        }));
      }
    }
    this.session = new OverlaySession({
      fighterId: fighter,
      accessoryId,
      animation: anim,
      frameCount,
      frames,
      keyframes: entry?.keyframes ?? null,
      lastEditedAt: entry?.lastEditedAt ?? null,
    });
    this.frameIdx = Math.min(this.frameIdx, frameCount - 1);
    this._sessionDirty = false;
    this._loadedFrames = this.session.frames.map((f) => ({ ...f }));
    this._render();
  }

  /**
   * Return the scale currently used for this (fighter, category) in the
   * manifest, or null if the combo has no calibrated sibling. Assumes all
   * frames of all anims share the same scale (the UI enforces this).
   */
  _sharedScale(fighter, category) {
    const byAnim = this.manifest.calibrations?.[fighter]?.[category];
    if (!byAnim) return null;
    for (const entry of Object.values(byAnim)) {
      if (entry?.frames?.length) return entry.frames[0].scale;
    }
    return null;
  }

  _flushSessionToManifest() {
    if (!this.session || !this._sessionDirty) return;
    this.manifest.set(this._fighter(), this._category(), this._anim(), {
      frameCount: this.session.frameCount,
      frames: this.session.frames,
      keyframes: this.session.keyframes,
      lastEditedAt: this.session.lastEditedAt,
    });
    this._sessionDirty = false;
  }

  _markDirty() {
    this._sessionDirty = true;
  }

  // --- Editing ---

  _applyDelta(delta) {
    if (!this.session) return;
    // Scale is uniform across all frames of all anims for this (fighter,
    // accessory). Apply the x/y/rotation parts to just the current frame,
    // and broadcast any scale delta to every calibrated sibling.
    const { scale: scaleDelta, ...nonScale } = delta;
    if (Object.keys(nonScale).length > 0) {
      this.session.applyTransform(this.frameIdx, nonScale);
      this._markDirty();
    }
    if (scaleDelta !== undefined && scaleDelta !== 0) {
      const newScale = this._clampScale(this.session.frames[this.frameIdx].scale + scaleDelta);
      this._broadcastScale(newScale);
      this._markDirty();
    }
    this._render();
  }

  _clampScale(s) {
    if (s < 0.05) return 0.05;
    if (s > 4) return 4;
    return s;
  }

  _broadcastScale(newScale) {
    // Update every frame of the current in-memory session.
    for (let i = 0; i < this.session.frameCount; i++) {
      const f = this.session.frames[i];
      this.session.setTransform(i, { x: f.x, y: f.y, rotation: f.rotation, scale: newScale });
    }
    // Update every other calibrated anim for this (fighter, category) so the
    // scale stays uniform after the next save. Route through `manifest.set()`
    // instead of mutating frames in place so any future clamping/validation
    // on `set()` applies here too.
    const fighter = this._fighter();
    const category = this._category();
    const currentAnim = this._anim();
    const byAnim = this.manifest.calibrations?.[fighter]?.[category];
    if (!byAnim) return;
    for (const [anim, entry] of Object.entries(byAnim)) {
      if (anim === currentAnim) continue;
      this.manifest.set(fighter, category, anim, {
        frameCount: entry.frameCount,
        frames: entry.frames.map((f) => ({ ...f, scale: newScale })),
        keyframes: entry.keyframes,
      });
    }
  }
  _copyFromPrev() {
    this.session?.copyFromPrev(this.frameIdx);
    this._markDirty();
    this._render();
  }
  _copyToNext() {
    if (!this.session) return;
    if (this.frameIdx + 1 >= this.session.frameCount) return;
    this.session.setTransform(this.frameIdx + 1, this.session.frames[this.frameIdx]);
    this._markDirty();
    this._render();
  }
  _interpolate() {
    if (!this.session) return;
    if (this.session.keyframes.length === 0) {
      this.ui.setStatus('sin keyframes (F para marcar)');
      return;
    }
    this.session.interpolate();
    this._markDirty();
    this._render();
    this.ui.setStatus(`interpolado ${this.session.keyframes.length} kf`);
  }
  _toggleKeyframe() {
    if (!this.session) return;
    const was = this.session.keyframes.includes(this.frameIdx);
    this.session.toggleKeyframe(this.frameIdx);
    this._markDirty();
    this._render();
    this.ui.setStatus(
      was ? `frame ${this.frameIdx + 1} des-keyframe` : `frame ${this.frameIdx + 1} keyframe`,
    );
  }
  _resetFrame() {
    this.session?.resetFrame(this.frameIdx);
    this._markDirty();
    this._render();
  }

  _fillAllFrames() {
    if (!this.session) return;
    const src = this.session.frames[this.frameIdx];
    for (let i = 0; i < this.session.frameCount; i++) {
      if (i === this.frameIdx) continue;
      this.session.setTransform(i, {
        x: src.x,
        y: src.y,
        rotation: src.rotation,
        scale: src.scale,
      });
    }
    this._markDirty();
    this._render();
    this.ui.setStatus(`copiado a los ${this.session.frameCount - 1} frames restantes`);
  }
  /**
   * Propagate the offset between the current frame's position and its
   * originally-loaded position to every frame of every animation for this
   * (fighter, category). This lets the user adjust a hat once and apply that
   * same shift everywhere without overwriting per-frame head-tracking data.
   */
  _propagateOffset() {
    if (!this.session || !this._loadedFrames) return;
    const current = this.session.frames[this.frameIdx];
    const original = this._loadedFrames[this.frameIdx];
    if (!original) {
      this.ui.setStatus('sin referencia de calibración');
      return;
    }

    const dx = current.x - original.x;
    const dy = current.y - original.y;
    const dRotation = current.rotation - original.rotation;

    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(dRotation) < 0.001) {
      this.ui.setStatus('sin cambios para propagar');
      return;
    }

    // Apply delta to all other frames in the current session.
    for (let i = 0; i < this.session.frameCount; i++) {
      if (i === this.frameIdx) continue;
      const f = this.session.frames[i];
      this.session.setTransform(i, {
        x: f.x + dx,
        y: f.y + dy,
        rotation: f.rotation + dRotation,
        scale: f.scale,
      });
    }
    this._markDirty();

    // Apply delta to every other calibrated animation for this (fighter, category).
    const fighter = this._fighter();
    const category = this._category();
    const currentAnim = this._anim();
    const byAnim = this.manifest.calibrations?.[fighter]?.[category];
    if (byAnim) {
      for (const [anim, entry] of Object.entries(byAnim)) {
        if (anim === currentAnim) continue;
        this.manifest.set(fighter, category, anim, {
          frameCount: entry.frameCount,
          frames: entry.frames.map((f) => ({
            x: f.x + dx,
            y: f.y + dy,
            rotation: f.rotation + dRotation,
            scale: f.scale,
          })),
          keyframes: entry.keyframes,
        });
      }
    }

    // Update baseline so propagating again doesn't double-apply.
    this._loadedFrames = this.session.frames.map((f) => ({ ...f }));

    this._render();
    const parts = [];
    if (Math.abs(dx) >= 0.01 || Math.abs(dy) >= 0.01)
      parts.push(`Δx=${dx.toFixed(1)} Δy=${dy.toFixed(1)}`);
    if (Math.abs(dRotation) >= 0.001)
      parts.push(`Δrot=${((dRotation * 180) / Math.PI).toFixed(1)}°`);
    this.ui.setStatus(`offset propagado (${parts.join(', ')})`);
  }

  _undo() {
    if (this.session?.undo()) this._markDirty();
    this._render();
  }
  _redo() {
    if (this.session?.redo()) this._markDirty();
    this._render();
  }
  _cycleAnim(d) {
    this._flushSessionToManifest();
    this.animIdx = (this.animIdx + d + ANIM_NAMES.length) % ANIM_NAMES.length;
    this._syncSessionFromManifest();
  }
  _cycleFrame(d) {
    if (!this.session) return;
    this.frameIdx = (this.frameIdx + d + this.session.frameCount) % this.session.frameCount;
    this._render();
  }

  // --- Save ---

  async _saveManifest() {
    this._flushSessionToManifest();
    this.ui.setStatus('guardando…');
    try {
      const res = await fetch(DEV_EXPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: MANIFEST_PATH, json: this.manifest.toJSON() }),
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok) {
        this.ui.setStatus('manifest guardado ✓');
        this._render();
      } else if (ct.includes('text/html')) {
        this.ui.setStatus('plugin no cargado (reiniciá vite)');
      } else {
        this.ui.setStatus(`fallo guardar: ${res.status}`);
      }
    } catch (e) {
      this.ui.setStatus('fallo guardar (¿está corriendo vite?)');
      log.warn('save failed', { err: e.message });
    }
    this.ui.root?.focus();
  }

  // --- Rendering ---

  _render() {
    if (!this.session) return;
    const fighter = this._fighter();
    const accessoryId = this._accessoryId();
    const category = this._category();
    const anim = this._anim();
    const frame = this.session.frames[this.frameIdx];

    const fighterKey = `fighter_${fighter}_${anim}`;
    if (this.textures.exists(fighterKey)) {
      this.fighterSprite.setTexture(fighterKey, this.frameIdx);
      this.fighterSprite.setDisplaySize(PREVIEW_SIZE, PREVIEW_SIZE);
    } else {
      this.fighterSprite.setTexture('__DEFAULT');
    }

    if (this.onionSkin && this.frameIdx > 0 && this.textures.exists(fighterKey)) {
      this.onionSprite.setTexture(fighterKey, this.frameIdx - 1);
      this.onionSprite.setDisplaySize(PREVIEW_SIZE, PREVIEW_SIZE);
      this.onionSprite.setVisible(true);
    } else {
      this.onionSprite.setVisible(false);
    }

    const accKey = `accessory_${accessoryId}`;
    if (this.textures.exists(accKey)) {
      this.overlaySprite.setTexture(accKey);
      const src = this.textures.get(accKey).getSourceImage();
      // Base width formula is shared with the runtime (src/entities/Fighter.js
      // via src/editor/math.js) so the editor preview matches in-game render.
      const sizePx = overlayBaseWidth(FIGHTER_HEIGHT, frame.scale) * ZOOM;
      this.overlaySprite.setDisplaySize(sizePx, sizePx * (src.height / src.width));
      this.overlaySprite.setPosition(this._frameToScreenX(frame.x), this._frameToScreenY(frame.y));
      this.overlaySprite.setRotation(frame.rotation);
      this.overlaySprite.setVisible(true);
    } else {
      this.overlaySprite.setVisible(false);
    }

    this.ui?.update({
      fighter,
      accessory: accessoryId,
      category,
      animation: anim,
      frameIdx: this.frameIdx,
      frameCount: this.session.frameCount,
      keyframes: this.session.keyframes,
      manifest: this.manifest,
    });
  }

  _frameToScreenX(fx) {
    return PREVIEW_LEFT + fx * ZOOM;
  }
  _frameToScreenY(fy) {
    return PREVIEW_TOP + fy * ZOOM;
  }
}
