import Phaser from 'phaser';
import { FIGHTER_HEIGHT, FIGHTER_WIDTH, GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import accessoryCatalog from '../data/accessories.json';
import { resolveOverlayTransform } from '../entities/overlay-transform.js';
import { createButton } from '../services/UIService.js';
import { autoPickAccessories, calibratedCategories } from './accessory-select-helpers.js';

const PREFS_KEY = 'accessoriesByFighter';

// Fixed list of all categories in the catalog. We list every one so the
// player sees a category selector even when only one category is populated.
const ALL_CATEGORIES = [...new Set(accessoryCatalog.map((a) => a.category))];

const PREVIEW_SCALE = 0.7; // 128 * 0.7 ≈ 90 px

/**
 * Per-player accessory selection screen with live fighter preview.
 *
 * Layout per side:
 *   - fighter name
 *   - preview: fighter idle frame + calibrated overlay strips stacked on top
 *   - row of category tabs (all categories, grayed out if uncalibrated)
 *   - row of accessory thumbnails for the active category
 */
export class AccessorySelectScene extends Phaser.Scene {
  constructor() {
    super('AccessorySelectScene');
  }

  init(data) {
    this.p1Id = data.p1Id;
    this.p2Id = data.p2Id;
    this.gameMode = data.gameMode || 'local';
    this.networkManager = data.networkManager || null;
    this.matchContext = data.matchContext || null;
    // Tournament matches pre-pick the stage in BracketScene and skip
    // StageSelectScene; they pass `nextScene: 'PreFightScene'` plus stage
    // fields on `matchContext` so AccessorySelectScene can forward them through.
    this.nextScene = this.matchContext?.nextScene ?? 'StageSelectScene';
    this.stageId = this.matchContext?.stageId ?? null;
    this.isRandomStage = this.matchContext?.isRandomStage ?? false;
    this.transitioning = false;
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);

    this.cameras.main.fadeIn(300, 0, 0, 0);

    const manifest = this.game.registry.get('overlayManifest');
    this._humanSlotSet = this._humanSlots();

    // Online: subscribe for the peer's picks as early as possible. SignalingClient
    // buffers the message if it arrives before we subscribe (B5). The subscription
    // + the delayedCall timeout must not fire after scene shutdown; `_shutdown`
    // flag guards both the callback and `_finalizeOnline`.
    this._peerAccessories = undefined;
    this._localAccessoriesSent = false;
    this._finalized = false;
    this._shutdown = false;
    this._peerGone = false;
    this._peerTimer = null;
    if (this.gameMode === 'online' && this.networkManager) {
      this.networkManager.onAccessories?.((accessories) => {
        if (this._shutdown) return;
        this._peerAccessories = sanitizeAccessories(accessories);
        if (this._localAccessoriesSent) this._finalizeOnline();
      });
      // Peer drop before we finalize: proceed with empty peer payload if we
      // already sent ours; otherwise bounce to SelectScene so the user isn't
      // stuck picking for a match that will never start.
      this.networkManager.onDisconnect?.(() => this._handlePeerGone('disconnect'));
      this.networkManager.onLeave?.(() => this._handlePeerGone('leave'));
    }

    this.events.once('shutdown', () => {
      this._shutdown = true;
      if (this._peerTimer) {
        this._peerTimer.remove(false);
        this._peerTimer = null;
      }
      // Release handler closures AND flush the B5 buffer so a stale
      // `accessories` arriving between shutdown and the next subscribe
      // doesn't bleed into the subsequent match.
      if (this.gameMode === 'online' && this.networkManager?.signaling) {
        this.networkManager.signaling.resetHandlers(['accessories', 'leave', 'disconnect']);
      }
    });

    this.p1Calibrated = new Set(calibratedCategories(manifest, this.p1Id));
    this.p2Calibrated = new Set(calibratedCategories(manifest, this.p2Id));

    // Auto-skip when no human slot has anything to pick. Bot slots still
    // get auto-picked accessories in `_advance`.
    const p1NeedsPick = this._humanSlotSet.has(0) && this.p1Calibrated.size > 0;
    const p2NeedsPick = this._humanSlotSet.has(1) && this.p2Calibrated.size > 0;
    if (!p1NeedsPick && !p2NeedsPick) {
      this._advance();
      return;
    }

    this.prefs = loadPrefs();
    this.p1 = this._humanSlotSet.has(0) ? this._initPlayer(this.p1Id, this.p1Calibrated) : null;
    this.p2 = this._humanSlotSet.has(1) ? this._initPlayer(this.p2Id, this.p2Calibrated) : null;

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x161628);
    this.add
      .text(GAME_WIDTH / 2, 6, 'ACCESORIOS', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffcc44',
      })
      .setOrigin(0.5, 0);

    if (this.p1) this._buildColumn(GAME_WIDTH * 0.25, this.p1);
    if (this.p2) this._buildColumn(GAME_WIDTH * 0.75, this.p2);

    createButton(this, GAME_WIDTH / 2 - 60, GAME_HEIGHT - 14, 'ATRÁS', () => this._back(), {
      width: 80,
      height: 20,
      fontSize: '10px',
    });
    createButton(this, GAME_WIDTH / 2 + 60, GAME_HEIGHT - 14, 'CONFIRMAR', () => this._advance(), {
      width: 96,
      height: 20,
      fontSize: '10px',
    });

    this.input.keyboard.on('keydown-ENTER', () => this._advance());
    // ESC/BACKSPACE: normal back, or "skip wait" if we're already waiting on
    // peer accessories online (see `_back`).
    this.input.keyboard.on('keydown-ESC', () => this._back());
    this.input.keyboard.on('keydown-BACKSPACE', () => this._back());
  }

  _back() {
    // Online edge case: once we've sent `accessories` we can't truly "go back"
    // without desync (peer already has our payload and may have advanced).
    // Instead, treat BACK / ESC as "stop waiting, proceed with what we have".
    if (this.gameMode === 'online' && this._localAccessoriesSent && !this._finalized) {
      this._finalizeOnline();
      return;
    }
    if (this.transitioning) return;
    this.transitioning = true;
    // Tell the server we're leaving STAGE_SELECT so the peer (still in the
    // picker) gets `leave` and bounces back with us instead of waiting out
    // the 10 s fallback alone.
    if (this.gameMode === 'online' && !this._peerGone) {
      this.networkManager?.sendLeave?.();
    }
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('SelectScene', {
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: this.matchContext,
      });
    });
  }

  /**
   * Peer disconnected or left mid-pick.
   *  - Already sent our payload → finalize locally with empty peer payload.
   *  - Still picking → abort and return to SelectScene.
   */
  _handlePeerGone(_reason) {
    if (this._shutdown || this._finalized || this._peerGone) return;
    this._peerGone = true;
    if (this._localAccessoriesSent) {
      this._peerAccessories = this._peerAccessories ?? {};
      this._finalizeOnline();
      return;
    }
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('SelectScene', {
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: this.matchContext,
      });
    });
  }

  /**
   * Which slots have a local human doing the picking. Bots (1P vs AI,
   * tournament bots) and remote peers fall outside this set; their columns
   * aren't rendered here — bot picks are auto-generated in `_advance`,
   * online peer picks arrive via `networkManager.onAccessories`.
   *
   * @returns {Set<0 | 1>}
   */
  _humanSlots() {
    const slots = new Set();
    if (this.matchContext?.type === 'versus' || this.matchContext?.isHumanVsHuman) {
      slots.add(0);
      slots.add(1);
      return slots;
    }
    if (this.gameMode === 'online') {
      // Online sync is handled in `AccessorySelectScene` via a one-shot
      // `accessories` relay; each peer only renders their own slot.
      const localSlot = this.networkManager?.playerSlot ?? 0;
      slots.add(localSlot);
      return slots;
    }
    // Tournament human-vs-bot — BracketScene sets humanP1 / humanP2.
    if (this.matchContext?.humanP1 !== undefined || this.matchContext?.humanP2 !== undefined) {
      if (this.matchContext.humanP1) slots.add(0);
      if (this.matchContext.humanP2) slots.add(1);
      return slots;
    }
    // Plain local 1P vs AI — only P1 is human.
    slots.add(0);
    return slots;
  }

  _initPlayer(fighterId, calibrated) {
    const choices = {};
    for (const cat of ALL_CATEGORIES) {
      choices[cat] = this.prefs[fighterId]?.[cat] ?? null;
    }
    // Active category defaults to the first calibrated one (so the selector
    // lands on something useful), falling back to the first in the catalog.
    const activeCategory = ALL_CATEGORIES.find((c) => calibrated.has(c)) ?? ALL_CATEGORIES[0];
    return { fighterId, calibrated, choices, activeCategory, refs: {} };
  }

  _buildColumn(centerX, player) {
    // Fighter name
    this.add
      .text(centerX, 22, player.fighterId.toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#88aaff',
      })
      .setOrigin(0.5, 0);

    // Preview: fighter idle + one overlay sprite per chosen accessory.
    const previewY = 90;
    const fighterTex = this.textures.exists(`fighter_${player.fighterId}_idle`)
      ? `fighter_${player.fighterId}_idle`
      : null;
    if (fighterTex) {
      // Idle frame 0; sprites use origin (0.5, 1) so previewY is the foot line.
      const fighterSprite = this.add.sprite(centerX, previewY, fighterTex, 0);
      fighterSprite.setOrigin(0.5, 1);
      fighterSprite.setScale(PREVIEW_SCALE);
      player.refs.fighterSprite = fighterSprite;
    }
    player.refs.overlaySprites = new Map();
    this._rebuildPreviewOverlays(player, centerX, previewY);

    // Equipped-accessory label below the preview.
    player.refs.equippedLabel = this.add
      .text(centerX, previewY + 4, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffcc88',
        align: 'center',
        wordWrap: { width: 120 },
      })
      .setOrigin(0.5, 0);
    this._updateEquippedLabel(player);

    if (player.calibrated.size === 0) {
      this.add
        .text(centerX, previewY + 10, 'sin calibración', {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#666688',
        })
        .setOrigin(0.5, 0);
      return;
    }

    // Category tab row — leave room for the equipped-accessory label between
    // the preview's foot line and the tabs, so a two-word name doesn't clash.
    const tabsY = previewY + 28;
    this._buildCategoryTabs(centerX, tabsY, player);

    // Accessory thumbnails for active category
    const accY = tabsY + 24;
    player.refs.accContainer = this.add.container(0, 0);
    this._rebuildAccessoryRow(player, centerX, accY);
  }

  _buildCategoryTabs(centerX, y, player) {
    const tabW = 50;
    const gap = 4;
    const total = ALL_CATEGORIES.length * tabW + (ALL_CATEGORIES.length - 1) * gap;
    const startX = centerX - total / 2 + tabW / 2;
    player.refs.tabRects = new Map();
    ALL_CATEGORIES.forEach((cat, i) => {
      const x = startX + i * (tabW + gap);
      const calibrated = player.calibrated.has(cat);
      const bg = this.add.rectangle(x, y, tabW, 14, 0x252540);
      bg.setStrokeStyle(1, 0x4466aa);
      const label = this.add
        .text(x, y, cat.toUpperCase(), {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: calibrated ? '#cfd4ff' : '#666688',
        })
        .setOrigin(0.5);
      if (calibrated) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerdown', () => this._switchCategory(player, cat));
        label.setInteractive({ useHandCursor: true });
        label.on('pointerdown', () => this._switchCategory(player, cat));
      }
      player.refs.tabRects.set(cat, { bg, label, calibrated });
    });
    this._highlightActiveTab(player);
  }

  _highlightActiveTab(player) {
    for (const [cat, r] of player.refs.tabRects) {
      const active = cat === player.activeCategory;
      r.bg.setStrokeStyle(active ? 2 : 1, active ? 0xffcc44 : 0x4466aa);
      r.bg.fillColor = active ? 0x3d3d66 : 0x252540;
    }
  }

  _switchCategory(player, category) {
    if (!player.calibrated.has(category)) return;
    player.activeCategory = category;
    this._highlightActiveTab(player);
    const centerX = player === this.p1 ? GAME_WIDTH * 0.25 : GAME_WIDTH * 0.75;
    this._rebuildAccessoryRow(player, centerX, player.refs.accContainer.y || 128);
    this.game.audioManager?.play?.('ui_navigate');
  }

  _rebuildAccessoryRow(player, centerX, y) {
    // Rebuild the container children for the active category.
    player.refs.accContainer.removeAll(true);
    player.refs.accContainer.y = y;

    const options = [null, ...accessoryCatalog.filter((a) => a.category === player.activeCategory)];
    const size = 28;
    const gap = 4;
    const totalW = options.length * size + (options.length - 1) * gap;
    const startX = centerX - totalW / 2 + size / 2;

    const tiles = [];
    options.forEach((opt, i) => {
      const x = startX + i * (size + gap);
      const bg = this.add.rectangle(x, 0, size, size, 0x222244);
      player.refs.accContainer.add(bg);
      if (opt) {
        const accKey = `accessory_${opt.id}`;
        if (this.textures.exists(accKey)) {
          const img = this.add.image(x, 0, accKey);
          const src = this.textures.get(accKey).getSourceImage();
          const scl = (size - 2) / Math.max(src.width, src.height);
          img.setScale(scl);
          player.refs.accContainer.add(img);
        }
      } else {
        const t = this.add.text(x, 0, '—', { fontSize: '14px', color: '#888' }).setOrigin(0.5);
        player.refs.accContainer.add(t);
      }
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this._pick(player, opt?.id ?? null, centerX));
      tiles.push({ bg, optId: opt?.id ?? null });
    });

    player.refs.accTiles = tiles;
    this._highlightPick(player);
  }

  _pick(player, accessoryId, previewCenterX) {
    player.choices[player.activeCategory] = accessoryId;
    this.prefs[player.fighterId] = {
      ...(this.prefs[player.fighterId] ?? {}),
      [player.activeCategory]: accessoryId,
    };
    savePrefs(this.prefs);
    this._highlightPick(player);
    this._rebuildPreviewOverlays(player, previewCenterX, 90);
    this._updateEquippedLabel(player);
    this.game.audioManager?.play?.('ui_navigate');
  }

  _updateEquippedLabel(player) {
    if (!player.refs.equippedLabel) return;
    const parts = [];
    for (const cat of ALL_CATEGORIES) {
      const id = player.choices[cat];
      if (!id) continue;
      const entry = accessoryCatalog.find((a) => a.id === id);
      if (entry) parts.push(entry.label);
    }
    player.refs.equippedLabel.setText(parts.length > 0 ? parts.join(' · ') : '(sin accesorios)');
    player.refs.equippedLabel.setColor(parts.length > 0 ? '#ffcc88' : '#666688');
  }

  _highlightPick(player) {
    if (!player.refs.accTiles) return;
    const active = player.choices[player.activeCategory] ?? null;
    for (const t of player.refs.accTiles) {
      const on = t.optId === active;
      t.bg.setStrokeStyle(on ? 2 : 1, on ? 0xffcc44 : 0x4466aa);
    }
  }

  _rebuildPreviewOverlays(player, centerX, previewY) {
    for (const s of player.refs.overlaySprites.values()) s.destroy();
    player.refs.overlaySprites.clear();

    // Render each chosen accessory using the same pipeline as in-fight:
    // source `accessory_{id}` PNG + `resolveOverlayTransform` applied to the
    // idle[0] calibration. Keeps picker and fight placement in lockstep.
    const manifest = this.game.registry.get('overlayManifest');
    const byCategory = manifest?.calibrations?.[player.fighterId];
    if (!byCategory) return;

    for (const [category, accessoryId] of Object.entries(player.choices)) {
      if (!accessoryId) continue;
      const cal = byCategory[category]?.idle?.frames?.[0];
      if (!cal) continue;
      const textureKey = `accessory_${accessoryId}`;
      if (!this.textures.exists(textureKey)) continue;

      const accessoryWidth = this.textures.get(textureKey).getSourceImage()?.width ?? 0;
      const transform = resolveOverlayTransform({
        cal,
        fighterX: 0,
        fighterY: 0,
        fighterWidth: FIGHTER_WIDTH,
        fighterHeight: FIGHTER_HEIGHT,
        facingRight: true,
        accessoryWidth,
      });
      if (!transform) continue;

      const sprite = this.add.sprite(
        centerX + transform.x * PREVIEW_SCALE,
        previewY + transform.y * PREVIEW_SCALE,
        textureKey,
      );
      sprite.setOrigin(0.5, 0.5);
      sprite.setRotation(transform.rotation);
      sprite.setScale(transform.scale * PREVIEW_SCALE);
      sprite.setDepth(1);
      player.refs.overlaySprites.set(category, sprite);
    }
  }

  _advance() {
    if (this.transitioning) return;
    if (this.gameMode === 'online') {
      this._startOnlineExchange();
      return;
    }
    this._doLocalAdvance();
  }

  /**
   * Online flow: send local picks, wait (with timeout) for peer's picks,
   * then transition with `accessories = { p1, p2 }` fully populated.
   *
   * Covers two races:
   *  - local Confirm before peer's message → wait here, finalize on receive
   *  - peer's message before local Confirm → `_peerAccessories` already set,
   *    finalize immediately
   */
  _startOnlineExchange() {
    if (this._localAccessoriesSent) return;
    this.transitioning = true;

    const localSlot = this.networkManager?.playerSlot ?? 0;
    const localPlayer = localSlot === 0 ? this.p1 : this.p2;
    this._localAccessories = localPlayer?.choices ?? {};
    this._localSlot = localSlot;
    this._localAccessoriesSent = true;
    this.networkManager?.sendAccessories?.(this._localAccessories);

    if (this._peerAccessories !== undefined) {
      this._finalizeOnline();
      return;
    }

    // Wait for peer. 10 s fallback so a dropped peer doesn't deadlock us.
    // `this.time.delayedCall` is auto-cancelled on scene shutdown.
    this._peerTimer = this.time.delayedCall(10000, () => this._finalizeOnline());
    this._showWaitingIndicator();
  }

  _finalizeOnline() {
    if (this._finalized || this._shutdown) return;
    this._finalized = true;
    if (this._peerTimer) {
      this._peerTimer.remove(false);
      this._peerTimer = null;
    }
    const peer = this._peerAccessories ?? {};
    const p1Choices = this._localSlot === 0 ? this._localAccessories : peer;
    const p2Choices = this._localSlot === 1 ? this._localAccessories : peer;
    this._goNext(p1Choices, p2Choices);
  }

  _doLocalAdvance() {
    this.transitioning = true;

    // Humans use their picks; bot slots get auto-picked accessories so
    // they're not at a visual (or future stat-bonus) disadvantage.
    // Tournaments pre-seed bot picks in `BracketScene.goToMatch` via the
    // seeded tournament PRNG so replays reproduce; honor those presets.
    const manifest = this.game.registry.get('overlayManifest');
    const humanSlots = this._humanSlotSet ?? this._humanSlots();
    const preset = this.matchContext?.accessories ?? {};
    const p1Choices = humanSlots.has(0)
      ? (this.p1?.choices ?? {})
      : (preset.p1 ?? autoPickAccessories(manifest, this.p1Id));
    const p2Choices = humanSlots.has(1)
      ? (this.p2?.choices ?? {})
      : (preset.p2 ?? autoPickAccessories(manifest, this.p2Id));
    this._goNext(p1Choices, p2Choices);
  }

  _goNext(p1Choices, p2Choices) {
    const ctx = { ...(this.matchContext ?? {}) };
    ctx.accessories = { p1: p1Choices, p2: p2Choices };

    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start(this.nextScene, {
        p1Id: this.p1Id,
        p2Id: this.p2Id,
        stageId: this.stageId,
        isRandomStage: this.isRandomStage,
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: ctx,
      });
    });
  }

  _showWaitingIndicator() {
    if (this._waitingText) return;
    this._waitingText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Esperando oponente...\n(ESC para saltar)', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffcc44',
        align: 'center',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(100);
  }
}

/**
 * Coerce a peer-supplied `accessories` payload into a plain `{category: id}` map.
 * Peer messages pass through PartyKit as a pure relay, so the server doesn't
 * validate shape — strings, arrays, nulls, etc. would all reach us otherwise.
 */
function sanitizeAccessories(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k === 'string' && (typeof v === 'string' || v === null)) {
      out[k] = v;
    }
  }
  return out;
}

// --- helpers ---

function loadPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}
