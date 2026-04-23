import { FIGHTER_HEIGHT, FIGHTER_WIDTH, GAME_HEIGHT, GAME_WIDTH } from '@alostraques/game/config';
import { ANIM_DEFS, ANIM_NAMES, FIGHTERS_WITH_SPRITES } from '@alostraques/game/data/animations.js';
import fightersData from '@alostraques/game/data/fighters.json';
import * as Phaser from 'phaser';

const LEFT_PANEL_WIDTH = 120;
const RIGHT_X = LEFT_PANEL_WIDTH + (GAME_WIDTH - LEFT_PANEL_WIDTH) / 2;

export class InspectorScene extends Phaser.Scene {
  constructor() {
    super('InspectorScene');
  }

  create() {
    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1a);

    // Header
    this.add.text(10, 8, 'INSPECTOR DE ASSETS', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '14px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    });

    // VOLVER button
    this._createButton(GAME_WIDTH - 45, 12, 'VOLVER', () => this.goBack());

    // Divider line
    this.add
      .rectangle(LEFT_PANEL_WIDTH, GAME_HEIGHT / 2, 1, GAME_HEIGHT - 28, 0x444488, 0.6)
      .setOrigin(0.5, 0.5);

    // Build fighter list
    this.selectedIndex = 0;
    this.animIndex = 0;
    this.listTexts = [];
    this.listDots = [];

    const listTop = 32;
    const rowH = 17;
    const listBottom = GAME_HEIGHT - 4;
    const visibleHeight = listBottom - listTop;

    // Container holds all list items; we scroll it vertically
    this.listContainer = this.add.container(0, 0);

    for (let i = 0; i < fightersData.length; i++) {
      const f = fightersData[i];
      const y = listTop + i * rowH;
      const hasSprites = FIGHTERS_WITH_SPRITES.includes(f.id);
      const color = parseInt(f.color.replace('0x', '#').replace('#', ''), 16);

      const dot = this.add.circle(10, y + 6, 4, color);
      this.listContainer.add(dot);
      this.listDots.push(dot);

      const txt = this.add
        .text(20, y, f.id, {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: hasSprites ? '#ffffff' : '#888888',
        })
        .setInteractive({ useHandCursor: true });

      txt.on('pointerdown', () => this.selectFighter(i));
      txt.on('pointerover', () => {
        if (i !== this.selectedIndex) txt.setColor(hasSprites ? '#ffcc00' : '#bbbb88');
      });
      txt.on('pointerout', () => {
        if (i !== this.selectedIndex) txt.setColor(hasSprites ? '#ffffff' : '#888888');
      });

      if (hasSprites) {
        const star = this.add
          .text(LEFT_PANEL_WIDTH - 12, y, '*', {
            fontFamily: 'Arial',
            fontSize: '11px',
            color: '#ffcc00',
          })
          .setOrigin(1, 0);
        this.listContainer.add(star);
      }

      this.listContainer.add(txt);
      this.listTexts.push(txt);
    }

    // Mask the list to the visible panel area
    const maskShape = this.make.graphics({ x: 0, y: 0, add: false });
    maskShape.fillRect(0, listTop, LEFT_PANEL_WIDTH - 2, visibleHeight);
    this.listContainer.setMask(new Phaser.Display.Masks.GeometryMask(this, maskShape));

    // Scroll limits
    this.listContentHeight = fightersData.length * rowH;
    this.listVisibleHeight = visibleHeight;
    this.listTop = listTop;
    this.listRowH = rowH;
    this.listScrollY = 0;
    this.listMinScroll = Math.min(0, -(this.listContentHeight - visibleHeight));

    // Touch/pointer drag scrolling on left panel
    this.input.on('pointermove', (pointer) => {
      if (!pointer.isDown || pointer.x > LEFT_PANEL_WIDTH) return;
      const dy = pointer.y - pointer.prevPosition.y;
      if (dy === 0) return;
      this._scrollList(this.listScrollY + dy);
    });

    // Right panel elements
    this.portraitImage = this.add
      .image(LEFT_PANEL_WIDTH + 20, 42, '__DEFAULT')
      .setOrigin(0, 0)
      .setDisplaySize(48, 48)
      .setVisible(false);
    this.portraitFallback = this.add
      .rectangle(LEFT_PANEL_WIDTH + 44, 66, 48, 48, 0x333333)
      .setVisible(false);

    this.nameText = this.add.text(LEFT_PANEL_WIDTH + 76, 38, '', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '13px',
      color: '#ffffff',
    });

    this.subtitleText = this.add.text(LEFT_PANEL_WIDTH + 76, 56, '', {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#aaaacc',
      fontStyle: 'italic',
    });

    this.noSpritesLabel = this.add
      .text(RIGHT_X, 170, '(sin sprites)', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: '#ff6666',
      })
      .setOrigin(0.5)
      .setVisible(false);

    // Preview sprite
    this.previewSprite = this.add
      .sprite(RIGHT_X, 150, 'fighter_p1')
      .setDisplaySize(FIGHTER_WIDTH, FIGHTER_HEIGHT);

    // Anim info
    this.animInfoText = this.add
      .text(RIGHT_X, 225, '', {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#ccccff',
      })
      .setOrigin(0.5);

    // Prev / Next buttons
    this._createButton(RIGHT_X - 60, 250, '< ANT', () => this.selectAnim(this.animIndex - 1));
    this._createButton(RIGHT_X + 60, 250, 'SIG >', () => this.selectAnim(this.animIndex + 1));

    // Keyboard controls
    this.input.keyboard.on('keydown-UP', () => this.selectFighter(this.selectedIndex - 1));
    this.input.keyboard.on('keydown-DOWN', () => this.selectFighter(this.selectedIndex + 1));
    this.input.keyboard.on('keydown-LEFT', () => this.selectAnim(this.animIndex - 1));
    this.input.keyboard.on('keydown-RIGHT', () => this.selectAnim(this.animIndex + 1));
    this.input.keyboard.on('keydown-ESC', () => this.goBack());
    this.input.keyboard.on('keydown-Z', () => this.replayAnim());
    this.input.keyboard.on('keydown-X', () => this.stepFrame(1));
    this.input.keyboard.on('keydown-C', () => this.stepFrame(-1));

    // Select first fighter with sprites, or first fighter
    const firstSpriteIdx = fightersData.findIndex((f) => FIGHTERS_WITH_SPRITES.includes(f.id));
    this.selectFighter(firstSpriteIdx >= 0 ? firstSpriteIdx : 0);
  }

  getNavMenu() {
    return { items: this.listTexts };
  }

  selectFighter(index) {
    // Wrap around
    const len = fightersData.length;
    index = ((index % len) + len) % len;

    // Unhighlight previous
    if (this.selectedIndex !== undefined) {
      const prevF = fightersData[this.selectedIndex];
      const prevHas = FIGHTERS_WITH_SPRITES.includes(prevF.id);
      this.listTexts[this.selectedIndex].setColor(prevHas ? '#ffffff' : '#888888');
    }

    this.selectedIndex = index;
    const fighter = fightersData[index];
    const hasSprites = FIGHTERS_WITH_SPRITES.includes(fighter.id);

    // Highlight selected
    this.listTexts[index].setColor('#ffcc00');

    // Auto-scroll to keep selected item visible
    const itemY = index * this.listRowH; // position relative to list start
    const viewTop = -this.listScrollY;
    const viewBottom = viewTop + this.listVisibleHeight;
    if (itemY < viewTop) {
      this._scrollList(-itemY);
    } else if (itemY + this.listRowH > viewBottom) {
      this._scrollList(-(itemY + this.listRowH - this.listVisibleHeight));
    }

    // Update name/subtitle
    this.nameText.setText(fighter.name);
    this.subtitleText.setText(fighter.subtitle);

    // Portrait
    const portraitKey = `portrait_${fighter.id}`;
    if (this.textures.exists(portraitKey)) {
      this.portraitImage.setTexture(portraitKey).setDisplaySize(48, 48).setVisible(true);
      this.portraitFallback.setVisible(false);
    } else {
      this.portraitImage.setVisible(false);
      const color = parseInt(fighter.color.replace('0x', ''), 16);
      this.portraitFallback.setFillStyle(color).setVisible(true);
    }

    this.hasAnims = hasSprites;
    this.currentFighterId = fighter.id;

    // Reset to idle
    this.selectAnim(0);
  }

  selectAnim(index) {
    const len = ANIM_NAMES.length;
    this.animIndex = ((index % len) + len) % len;

    const animName = ANIM_NAMES[this.animIndex];
    const def = ANIM_DEFS[animName];
    const loopText = def.repeat === -1 ? 'bucle' : 'una vez';

    if (this.hasAnims) {
      const textureKey = `fighter_${this.currentFighterId}_${animName}`;
      const animKey = `${this.currentFighterId}_${animName}`;

      this.previewSprite.setTexture(textureKey, 0);
      this.previewSprite.setDisplaySize(FIGHTER_WIDTH, FIGHTER_HEIGHT);
      this.previewSprite.play(animKey);

      this.noSpritesLabel.setVisible(false);
      this.animInfoText.setText(`Anim: ${animName} (${def.frames} frames, ${loopText})`);
    } else {
      this.previewSprite.stop();
      this.previewSprite.setTexture('fighter_p1');
      this.previewSprite.setDisplaySize(FIGHTER_WIDTH, FIGHTER_HEIGHT);

      this.noSpritesLabel.setVisible(true);
      this.animInfoText.setText(`Anim: ${animName} (${def.frames} frames, ${loopText})`);
    }
  }

  stepFrame(dir) {
    if (!this.hasAnims) return;
    this.previewSprite.anims.pause();
    const anim = this.previewSprite.anims;
    const totalFrames = anim.currentAnim.frames.length;
    const current = anim.currentFrame.index; // 1-based
    let next = current + dir;
    if (next < 1) next = totalFrames;
    if (next > totalFrames) next = 1;
    anim.setCurrentFrame(anim.currentAnim.frames[next - 1]);
    this._updateFrameInfo();
  }

  _updateFrameInfo() {
    const animName = ANIM_NAMES[this.animIndex];
    const def = ANIM_DEFS[animName];
    const loopText = def.repeat === -1 ? 'bucle' : 'una vez';
    const anim = this.previewSprite.anims;
    const paused = !anim.isPlaying || anim.isPaused;
    const frameStr = paused ? ` [frame ${anim.currentFrame.index}/${def.frames}]` : '';
    this.animInfoText.setText(`Anim: ${animName} (${def.frames} frames, ${loopText})${frameStr}`);
  }

  replayAnim() {
    if (!this.hasAnims) return;
    this.previewSprite.anims.restart();
    this.previewSprite.anims.resume();
    this._updateFrameInfo();
  }

  goBack() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('TitleScene');
    });
  }

  _scrollList(targetY) {
    this.listScrollY = Phaser.Math.Clamp(targetY, this.listMinScroll, 0);
    this.listContainer.setY(this.listScrollY);
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
    bg.on('pointerdown', () => callback());
  }
}
