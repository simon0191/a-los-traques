import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';

const CONTROLES_ORDENADOR = {
  title: 'CONTROLES (TECLADO)',
  body:
    'Mover: Flechas [←] [→] o WASD\n' +
    'Saltar: [↑] o [W] / Bloquear: [↓] o [S]\n\n' +
    'Ataques:\n' +
    '[Z] o [J]: Puño Liviano (PL)\n' +
    '[X] o [K]: Patada Liviana (PaL)\n' +
    '[A] o [U]: Puño Pesado (PP)\n' +
    '[S] o [I]: Patada Pesada (PaP)\n' +
    '[D] o [O]: Especial (ES)\n\n' +
    'Pausa: [ESC]',
};

const CONTROLES_MANDO = {
  title: 'CONTROLES (MANDO / GAMEPAD)',
  body:
    'Mover: D-Pad o Joystick Izquierdo\n' +
    'Saltar: Arriba / Bloquear: Abajo\n\n' +
    'Ataques:\n' +
    '[Cuadrado / X]: Puño Liviano (PL)\n' +
    '[Cruz / A]: Patada Liviana (PaL)\n' +
    '[Triangulo / Y]: Puño Pesado (PP)\n' +
    '[Circulo / B]: Patada Pesada (PaP)\n' +
    '[R1 / R2]: Especial (ES)\n\n' +
    'Pausa: [Options / Start]',
};

const CONTROLES_MOVIL = {
  title: 'CONTROLES (PANTALLA TÁCTIL)',
  body:
    'Lado izquierdo:\n' +
    'Joystick virtual para movimiento.\n\n' +
    'Lado derecho (5 botones):\n' +
    'PL (Puño Liviano)\n' +
    'PaL (Patada Liviana)\n' +
    'PP (Puño Pesado)\n' +
    'PaP (Patada Pesada)\n' +
    'ES (Especial)\n\n' +
    'Soporta Multi-touch (mover y atacar).',
};

const BASICO_CARDS = [
  {
    title: 'BLOQUEAR',
    body: 'Mantene abajo en el joystick o [↓]\npara bloquear. Reduce el dano un 80% y\nachica tu hitbox. Ideal contra ataques\npesados.',
  },
  {
    title: 'GOLPES LIVIANOS',
    body: 'Son rapidos y seguros. Salen rapido,\nse recuperan rapido. Ideales para\nempezar combos y mantener presion.',
  },
  {
    title: 'NO ABUSES GOLPES PESADOS',
    body: 'Los golpes pesados hacen mucho dano\npero si fallan quedas expuesto muchos\nframes. Usalos cuando estes seguro\nde que van a conectar.',
  },
  {
    title: 'MIRA TU STAMINA',
    body: 'Cada ataque gasta stamina (STA).\nSi atacas mucho seguido te quedas\nsin stamina y no podes atacar.\nDeja respirar a tu personaje.',
  },
];

const AVANZADO_CARDS = [
  {
    title: 'FASES DE ATAQUE',
    body: 'Todo ataque tiene 3 fases:\n- Startup: preparacion (vulnerable)\n- Activo: frames que hacen dano\n- Recuperacion: volviendo a neutral\nConocer estas fases es clave.',
  },
  {
    title: 'VENTAJA DE FRAMES',
    body: 'Despues de un bloqueo, el que se\nrecupera primero tiene "ventaja".\nGolpes livianos dejan ventaja positiva.\nPesados pueden dejar ventaja negativa.',
  },
  {
    title: 'CANCELAR EN ESPECIAL',
    body: 'Si un golpe normal conecta, podes\ncancelar la recuperacion en un especial.\nEsto se llama "hit confirm":\nnormal que pega → especial.',
  },
  {
    title: 'ESCALADO DE COMBO',
    body: 'El dano escala en combo:\n1er golpe: 100%\n2do golpe: 80%\n3er golpe: 65%\n4to golpe en adelante: 50%',
  },
  {
    title: 'MOVIMIENTO AEREO',
    body: 'Podes hacer doble salto en el aire.\nWall jump: salta contra una pared.\nWall slide: deslizate contra la pared\npara bajar mas lento.',
  },
  {
    title: 'RECURSOS',
    body: 'HP: vida. Llega a 0 y perdes.\nESP: barra especial. Necesitas 50+\npara tirar un especial.\nSTA: stamina. Se gasta al atacar,\nse regenera al no atacar.',
  },
];

const CONTENT_TOP = 52;
const CONTENT_BOTTOM = GAME_HEIGHT - 28;
const CONTENT_HEIGHT = CONTENT_BOTTOM - CONTENT_TOP;
const CARD_WIDTH = GAME_WIDTH - 40;
const CARD_PADDING = 8;
const CARD_GAP = 8;
const TITLE_FONT_SIZE = 11;
const BODY_FONT_SIZE = 10;
const BODY_LINE_HEIGHT = 1.2;

export class LearningScene extends Phaser.Scene {
  constructor() {
    super('LearningScene');
  }

  init() {
    // Device detection by touching support
    this.isMobile = this.sys.game.device.input.touch;
  }

  create() {
    this.cameras.main.fadeIn(300, 0, 0, 0);

    // Dark background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1a);

    // Title
    this.add
      .text(GAME_WIDTH / 2, 14, 'COMO JUGAR', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '16px',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    // Content container + mask
    this.contentContainer = this.add.container(0, 0);
    const maskShape = this.make.graphics();
    maskShape.fillRect(0, CONTENT_TOP, GAME_WIDTH, CONTENT_HEIGHT);
    const mask = maskShape.createGeometryMask();
    this.contentContainer.setMask(mask);

    // Scroll state
    this.scrollY = 0;
    this.maxScroll = 0;

    // Tab buttons
    this.activeTab = 'basico';
    this._createTabs();
    this._buildCardsForActiveTab();

    // Drag scrolling
    this.dragStartY = null;
    this.dragStartScroll = 0;
    this.input.on('pointerdown', (pointer) => {
      if (pointer.y >= CONTENT_TOP && pointer.y <= CONTENT_BOTTOM) {
        this.dragStartY = pointer.y;
        this.dragStartScroll = this.scrollY;
      }
    });
    this.input.on('pointermove', (pointer) => {
      if (this.dragStartY !== null && pointer.isDown) {
        const dy = this.dragStartY - pointer.y;
        this._setScroll(this.dragStartScroll + dy);
      }
    });
    this.input.on('pointerup', () => {
      this.dragStartY = null;
    });

    // Mouse wheel
    this.input.on('wheel', (_pointer, _gos, _dx, dy) => {
      this._setScroll(this.scrollY + dy * 0.5);
    });

    // VOLVER button
    this._createButton(GAME_WIDTH - 50, GAME_HEIGHT - 13, 'VOLVER', () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('TitleScene');
      });
    });

    // Scroll indicator
    this.scrollIndicator = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 13, '', {
        fontFamily: 'Arial',
        fontSize: '9px',
        color: '#666688',
      })
      .setOrigin(0.5);
    this._updateScrollIndicator();

    this.transitioning = false;
  }

  update(_time, delta) {
    if (this.transitioning) return;

    let scrollDir = 0;
    const cursors = this.input.keyboard.createCursorKeys();
    if (cursors.up.isDown) scrollDir = -1;
    if (cursors.down.isDown) scrollDir = 1;

    const pads = this.input.gamepad?.gamepads || [];
    for (const pad of pads) {
      if (!pad) continue;
      if (pad.up || (pad.axes[1]?.getValue() ?? 0) < -0.5) scrollDir = -1;
      if (pad.down || (pad.axes[1]?.getValue() ?? 0) > 0.5) scrollDir = 1;
    }

    if (scrollDir !== 0) {
      const speed = 0.3; // pixels per ms
      this._setScroll(this.scrollY + scrollDir * speed * delta);
    }
  }

  getNavMenu() {
    // Return as a single-row grid to allow horizontal navigation between tabs
    return {
      items: [[this.tabObjects[0], this.tabObjects[2]]],
      isGrid: true,
    };
  }

  // Cards to load
  _buildCardsForActiveTab() {
    if (this.activeTab === 'basico') {
      const cardsToShow = [...BASICO_CARDS];

      if (this.isMobile) {
        cardsToShow.unshift(CONTROLES_MANDO);
        cardsToShow.unshift(CONTROLES_MOVIL);
      } else {
        cardsToShow.unshift(CONTROLES_MANDO);
        cardsToShow.unshift(CONTROLES_ORDENADOR);
      }

      this._buildCards(cardsToShow);
    } else {
      this._buildCards(AVANZADO_CARDS);
    }
  }

  _createTabs() {
    const tabY = 36;
    const tabW = 80;
    const tabH = 18;
    const gap = 4;

    const basicoX = GAME_WIDTH / 2 - tabW / 2 - gap / 2;
    const avanzadoX = GAME_WIDTH / 2 + tabW / 2 + gap / 2;

    if (!this.tabObjects) {
      this.tabObjects = [];

      // BASICO tab
      const bBg = this.add
        .rectangle(basicoX, tabY, tabW, tabH, 0x222244)
        .setStrokeStyle(1, 0x4444aa)
        .setInteractive({ useHandCursor: true });
      const bText = this.add
        .text(basicoX, tabY, 'BÁSICO', {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: '#ffffff',
          fontStyle: 'normal',
        })
        .setOrigin(0.5);
      bBg.on('pointerdown', () => {
        if (this.activeTab === 'basico') return;
        this.game.audioManager?.play('ui_confirm');
        this.activeTab = 'basico';
        this._updateTabs();
        this._buildCardsForActiveTab();
        this.scrollY = 0;
        this._applyScroll();
      });

      // AVANZADO tab
      const aBg = this.add
        .rectangle(avanzadoX, tabY, tabW, tabH, 0x222244)
        .setStrokeStyle(1, 0x4444aa)
        .setInteractive({ useHandCursor: true });
      const aText = this.add
        .text(avanzadoX, tabY, 'AVANZADO', {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: '#ffffff',
          fontStyle: 'normal',
        })
        .setOrigin(0.5);
      aBg.on('pointerdown', () => {
        if (this.activeTab === 'avanzado') return;
        this.game.audioManager?.play('ui_confirm');
        this.activeTab = 'avanzado';
        this._updateTabs();
        this._buildCardsForActiveTab();
        this.scrollY = 0;
        this._applyScroll();
      });

      this.tabObjects.push(bBg, bText, aBg, aText);
    }

    this._updateTabs();
  }

  _updateTabs() {
    const isBasico = this.activeTab === 'basico';

    this.tabObjects[0].setFillStyle(isBasico ? 0x997700 : 0x222244);
    this.tabObjects[0].setStrokeStyle(1, isBasico ? 0xffcc00 : 0x4444aa);
    this.tabObjects[1].setColor(isBasico ? '#ffcc00' : '#ffffff');
    this.tabObjects[1].setFontStyle(isBasico ? 'bold' : 'normal');

    this.tabObjects[2].setFillStyle(!isBasico ? 0x997700 : 0x222244);
    this.tabObjects[2].setStrokeStyle(1, !isBasico ? 0xffcc00 : 0x4444aa);
    this.tabObjects[3].setColor(!isBasico ? '#ffcc00' : '#ffffff');
    this.tabObjects[3].setFontStyle(!isBasico ? 'bold' : 'normal');
  }

  _buildCards(cards) {
    // Clear existing content
    this.contentContainer.removeAll(true);

    let yOffset = CONTENT_TOP + CARD_GAP;

    for (const card of cards) {
      // Measure body text height
      const bodyText = this.add.text(0, 0, card.body, {
        fontFamily: 'Arial',
        fontSize: `${BODY_FONT_SIZE}px`,
        color: '#dddddd',
        lineSpacing: BODY_LINE_HEIGHT,
        wordWrap: { width: CARD_WIDTH - CARD_PADDING * 2 },
      });
      const bodyHeight = bodyText.height;
      bodyText.destroy();

      const cardHeight = CARD_PADDING + TITLE_FONT_SIZE + 4 + bodyHeight + CARD_PADDING;
      const cardX = GAME_WIDTH / 2;
      const cardY = yOffset + cardHeight / 2;

      // Card background
      const bg = this.add
        .rectangle(cardX, cardY, CARD_WIDTH, cardHeight, 0x1a1a3e)
        .setStrokeStyle(1, 0x333366);
      this.contentContainer.add(bg);

      // Card title
      const title = this.add
        .text(cardX - CARD_WIDTH / 2 + CARD_PADDING, yOffset + CARD_PADDING, card.title, {
          fontFamily: 'Arial Black, Arial',
          fontSize: `${TITLE_FONT_SIZE}px`,
          color: '#ffcc00',
        })
        .setOrigin(0, 0);
      this.contentContainer.add(title);

      // Card body
      const body = this.add
        .text(
          cardX - CARD_WIDTH / 2 + CARD_PADDING,
          yOffset + CARD_PADDING + TITLE_FONT_SIZE + 4,
          card.body,
          {
            fontFamily: 'Arial',
            fontSize: `${BODY_FONT_SIZE}px`,
            color: '#dddddd',
            lineSpacing: BODY_LINE_HEIGHT,
            wordWrap: { width: CARD_WIDTH - CARD_PADDING * 2 },
          },
        )
        .setOrigin(0, 0);
      this.contentContainer.add(body);

      yOffset += cardHeight + CARD_GAP;
    }

    this.totalContentHeight = yOffset - CONTENT_TOP;
    this._updateMaxScroll();
  }

  _updateMaxScroll() {
    if (this.totalContentHeight == null) return;
    this.maxScroll = Math.max(0, this.totalContentHeight - CONTENT_HEIGHT);
    this._updateScrollIndicator();
  }

  _setScroll(value) {
    this.scrollY = Phaser.Math.Clamp(value, 0, this.maxScroll);
    this._applyScroll();
    this._updateScrollIndicator();
  }

  _applyScroll() {
    this.contentContainer.y = -this.scrollY;
  }

  _updateScrollIndicator() {
    if (!this.scrollIndicator) return;
    if (this.maxScroll > 0) {
      this.scrollIndicator.setText('desliza para ver mas');
    } else {
      this.scrollIndicator.setText('');
    }
  }

  _createButton(x, y, label, callback) {
    const bg = this.add
      .rectangle(x, y, 70, 18, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });

    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    bg.on('pointerover', () => {
      bg.setFillStyle(0x333366);
      text.setColor('#ffcc00');
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(0x222244);
      text.setColor('#ffffff');
    });
    bg.on('pointerdown', () => {
      if (this.game.audioManager) this.game.audioManager.play('ui_confirm');
      callback();
    });
  }
}
