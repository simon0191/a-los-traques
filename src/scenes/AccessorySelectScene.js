import Phaser from 'phaser';
import { FIGHTER_HEIGHT, GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import accessoryCatalog from '../data/accessories.json';
import { createButton } from '../services/UIService.js';

const PREFS_KEY = 'accessoriesByFighter';

/**
 * Per-player accessory selection screen.
 *
 * Sits between SelectScene and StageSelectScene for local modes. Reads the
 * overlay manifest to discover which categories are calibrated for each
 * chosen fighter; only shows rows for those. For each row the player cycles
 * through the available accessories (or "ninguno"). Choices persist in
 * localStorage per fighter so the defaults come back next match.
 *
 * Auto-skips (transitions straight to StageSelectScene) if neither fighter
 * has any calibrated categories — nothing to pick.
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

    // Discover calibrated categories per player.
    this.p1Categories = calibratedCategories(manifest, this.p1Id);
    this.p2Categories = this._needsP2() ? calibratedCategories(manifest, this.p2Id) : [];

    // Auto-skip when neither fighter has anything to pick.
    if (this.p1Categories.length === 0 && this.p2Categories.length === 0) {
      this._advance();
      return;
    }

    // Load saved preferences.
    this.prefs = loadPrefs();
    this.p1Choices = seedChoices(this.prefs[this.p1Id], this.p1Categories);
    this.p2Choices = seedChoices(this.prefs[this.p2Id], this.p2Categories);

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x161628);

    // Title
    this.add
      .text(GAME_WIDTH / 2, 14, 'ACCESORIOS', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffcc44',
      })
      .setOrigin(0.5, 0);

    // Two columns — p1 left, p2 right (if applicable).
    this._buildColumn(GAME_WIDTH * 0.25, this.p1Id, this.p1Categories, this.p1Choices, 'p1');
    if (this._needsP2()) {
      this._buildColumn(GAME_WIDTH * 0.75, this.p2Id, this.p2Categories, this.p2Choices, 'p2');
    }

    // Confirm button
    createButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 20, 'CONFIRMAR', () => this._advance(), {
      width: 100,
      height: 22,
      fontSize: '11px',
    });

    this.input.keyboard.on('keydown-ENTER', () => this._advance());
    this.input.keyboard.on('keydown-ESC', () => {
      this.scene.start('SelectScene', {
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: this.matchContext,
      });
    });
  }

  _needsP2() {
    // VS AI: single-player fighter choice. VS Local / Tournament: both pick.
    if (this.matchContext?.type === 'versus') return true;
    if (this.matchContext?.isHumanVsHuman) return true;
    if (this.gameMode === 'local' && this.p2Id !== this.p1Id) {
      // Could still be VS AI — matchContext tells us. Fallback: show p2 row.
      return !this.matchContext?.vsAI;
    }
    return false;
  }

  _buildColumn(centerX, fighterId, categories, choices, side) {
    const startY = 50;
    const rowH = 52;

    this.add
      .text(centerX, 38, fighterId.toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#88aaff',
      })
      .setOrigin(0.5, 0);

    if (categories.length === 0) {
      this.add
        .text(centerX, startY + 16, 'sin accesorios\ncalibrados', {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#666688',
          align: 'center',
        })
        .setOrigin(0.5, 0);
      return;
    }

    categories.forEach((category, i) => {
      const y = startY + i * rowH;
      this._buildCategoryRow(centerX, y, category, choices, side);
    });
  }

  _buildCategoryRow(centerX, y, category, choices, side) {
    this.add
      .text(centerX, y, category.toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#cccccc',
      })
      .setOrigin(0.5, 0);

    const options = [null, ...accessoryCatalog.filter((a) => a.category === category)];
    const previewY = y + 14;
    const previewSize = 28;
    const gap = 4;
    const totalW = options.length * previewSize + (options.length - 1) * gap;
    const startX = centerX - totalW / 2 + previewSize / 2;

    const labels = [];
    options.forEach((opt, i) => {
      const x = startX + i * (previewSize + gap);
      const bg = this.add.rectangle(x, previewY, previewSize, previewSize, 0x222244);
      if (opt) {
        const accKey = `accessory_${opt.id}`;
        if (this.textures.exists(accKey)) {
          const img = this.add.image(x, previewY, accKey);
          const src = this.textures.get(accKey).getSourceImage();
          const scale = (previewSize - 2) / Math.max(src.width, src.height);
          img.setScale(scale);
          img.setInteractive({ useHandCursor: true });
          img.on('pointerdown', () => this._pick(side, category, opt.id, labels, previewY));
        } else {
          const t = this.add
            .text(x, previewY, opt.label.slice(0, 3), {
              fontSize: '8px',
              color: '#ccc',
            })
            .setOrigin(0.5);
          t.setInteractive({ useHandCursor: true });
          t.on('pointerdown', () => this._pick(side, category, opt.id, labels, previewY));
        }
      } else {
        const t = this.add
          .text(x, previewY, '—', {
            fontSize: '14px',
            color: '#888',
          })
          .setOrigin(0.5);
        t.setInteractive({ useHandCursor: true });
        t.on('pointerdown', () => this._pick(side, category, null, labels, previewY));
      }
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this._pick(side, category, opt?.id ?? null, labels, previewY));
      labels.push({ bg, x, optId: opt?.id ?? null });
    });

    this._highlightPick(labels, choices[category]);
  }

  _pick(side, category, accessoryId, labels, _previewY) {
    const choices = side === 'p1' ? this.p1Choices : this.p2Choices;
    choices[category] = accessoryId;
    const fighterId = side === 'p1' ? this.p1Id : this.p2Id;
    this.prefs[fighterId] = { ...(this.prefs[fighterId] ?? {}), [category]: accessoryId };
    savePrefs(this.prefs);
    this._highlightPick(labels, accessoryId);
    this.game.audioManager?.play?.('ui_navigate');
  }

  _highlightPick(labels, accessoryId) {
    for (const l of labels) {
      const active = l.optId === accessoryId;
      l.bg.setStrokeStyle(active ? 2 : 1, active ? 0xffcc44 : 0x4466aa);
    }
  }

  _advance() {
    if (this.transitioning) return;
    this.transitioning = true;

    // Merge picks into matchContext so StageSelect / PreFight / Fight can read it.
    const ctx = { ...(this.matchContext ?? {}) };
    ctx.accessories = {
      p1: this.p1Choices ?? {},
      p2: this.p2Choices ?? {},
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

function seedChoices(savedPrefs, categories) {
  const out = {};
  for (const c of categories) out[c] = savedPrefs?.[c] ?? null;
  return out;
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
