import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import accessoryCatalog from '../data/accessories.json';
import { createButton } from '../services/UIService.js';

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
    this.transitioning = false;
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);

    this.cameras.main.fadeIn(300, 0, 0, 0);

    const manifest = this.game.registry.get('overlayManifest');

    this.p1Calibrated = new Set(calibratedCategories(manifest, this.p1Id));
    this.p2Calibrated = this._needsP2()
      ? new Set(calibratedCategories(manifest, this.p2Id))
      : new Set();

    if (this.p1Calibrated.size === 0 && this.p2Calibrated.size === 0) {
      this._advance();
      return;
    }

    this.prefs = loadPrefs();
    this.p1 = this._initPlayer(this.p1Id, this.p1Calibrated);
    this.p2 = this._needsP2() ? this._initPlayer(this.p2Id, this.p2Calibrated) : null;

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x161628);
    this.add
      .text(GAME_WIDTH / 2, 6, 'ACCESORIOS', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffcc44',
      })
      .setOrigin(0.5, 0);

    this._buildColumn(GAME_WIDTH * 0.25, this.p1);
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
    this.input.keyboard.on('keydown-ESC', () => this._back());
    this.input.keyboard.on('keydown-BACKSPACE', () => this._back());
  }

  _back() {
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

  _needsP2() {
    if (this.matchContext?.type === 'versus') return true;
    if (this.matchContext?.isHumanVsHuman) return true;
    if (this.gameMode === 'local' && this.p2Id !== this.p1Id) {
      return !this.matchContext?.vsAI;
    }
    return false;
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
    // Destroy existing overlay sprites.
    for (const s of player.refs.overlaySprites.values()) s.destroy();
    player.refs.overlaySprites.clear();

    // One overlay sprite per non-null choice, using the idle strip (frame 0).
    for (const [category, accessoryId] of Object.entries(player.choices)) {
      if (!accessoryId) continue;
      const key = `overlay_${player.fighterId}_${accessoryId}_idle`;
      if (!this.textures.exists(key)) continue;
      const sprite = this.add.sprite(centerX, previewY, key, 0);
      sprite.setOrigin(0.5, 1);
      sprite.setScale(PREVIEW_SCALE);
      sprite.setDepth(1);
      player.refs.overlaySprites.set(category, sprite);
    }
  }

  _advance() {
    if (this.transitioning) return;
    this.transitioning = true;

    const ctx = { ...(this.matchContext ?? {}) };
    ctx.accessories = {
      p1: this.p1?.choices ?? {},
      p2: this.p2?.choices ?? {},
    };

    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('StageSelectScene', {
        p1Id: this.p1Id,
        p2Id: this.p2Id,
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: ctx,
      });
    });
  }
}

// --- helpers ---

function calibratedCategories(manifest, fighterId) {
  const cats = manifest?.calibrations?.[fighterId];
  if (!cats) return [];
  return Object.keys(cats).filter((cat) => accessoryCatalog.some((a) => a.category === cat));
}

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
