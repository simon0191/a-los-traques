import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import stages from '../data/stages.json';

// Auto-discover fight music MP3s at build time via Vite glob
const fightMusicFiles = Object.keys(import.meta.glob('/public/assets/audio/fights/*.mp3')).map(
  (p) => p.replace('/public', ''),
);

function formatSongName(path) {
  const filename = path.split('/').pop().replace('.mp3', '');
  return filename.replace(/-/g, ' ').toUpperCase();
}

export class MusicScene extends Phaser.Scene {
  constructor() {
    super('MusicScene');
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.stopMusic();
    audio.createMuteButton(this);

    this.playingIndex = -1;

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x1a1a2e);

    // Title
    this.add
      .text(GAME_WIDTH / 2, 25, 'MUSICA', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '24px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    // Decorative line
    this.add.rectangle(GAME_WIDTH / 2, 45, 200, 2, 0xccccff, 0.6);

    // Song list
    this.songRows = [];
    const startY = 70;
    const rowHeight = 26;

    for (let i = 0; i < fightMusicFiles.length; i++) {
      const y = startY + i * rowHeight;
      const name = formatSongName(fightMusicFiles[i]);

      const bg = this.add
        .rectangle(GAME_WIDTH / 2, y, 300, 22, 0x222244)
        .setStrokeStyle(1, 0x4444aa)
        .setInteractive({ useHandCursor: true });

      const text = this.add
        .text(GAME_WIDTH / 2, y, name, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: '#ffffff',
        })
        .setOrigin(0.5);

      bg.on('pointerover', () => {
        if (this.playingIndex !== i) {
          bg.setFillStyle(0x333366);
          text.setColor('#ffcc00');
        }
      });
      bg.on('pointerout', () => {
        if (this.playingIndex !== i) {
          bg.setFillStyle(0x222244);
          text.setColor('#ffffff');
        }
      });
      bg.on('pointerdown', () => {
        this.game.audioManager.play('ui_confirm');
        this._toggleSong(i);
      });

      this.songRows.push({ bg, text, name, audioKey: `bgm_fight_${i}` });
    }

    // Stage-specific tracks
    const stagesWithMusic = stages.filter((s) => s.soundtrack?.length);
    if (stagesWithMusic.length > 0) {
      const sectionY = startY + fightMusicFiles.length * rowHeight + 10;
      this.add
        .text(GAME_WIDTH / 2, sectionY, 'STAGE TRACKS', {
          fontFamily: 'Arial Black, Arial',
          fontSize: '14px',
          color: '#aaaaff',
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(0.5);

      let stageRowY = sectionY + 20;
      for (const stage of stagesWithMusic) {
        for (let j = 0; j < stage.soundtrack.length; j++) {
          const audioKey = `bgm_stage_${stage.id}_${j}`;
          const songName = `${stage.name} - ${formatSongName(stage.soundtrack[j])}`;
          const idx = this.songRows.length;

          const bg = this.add
            .rectangle(GAME_WIDTH / 2, stageRowY, 300, 22, 0x222244)
            .setStrokeStyle(1, 0x4444aa)
            .setInteractive({ useHandCursor: true });

          const text = this.add
            .text(GAME_WIDTH / 2, stageRowY, songName, {
              fontFamily: 'Arial',
              fontSize: '12px',
              color: '#ffffff',
            })
            .setOrigin(0.5);

          bg.on('pointerover', () => {
            if (this.playingIndex !== idx) {
              bg.setFillStyle(0x333366);
              text.setColor('#ffcc00');
            }
          });
          bg.on('pointerout', () => {
            if (this.playingIndex !== idx) {
              bg.setFillStyle(0x222244);
              text.setColor('#ffffff');
            }
          });
          bg.on('pointerdown', () => {
            this.game.audioManager.play('ui_confirm');
            this._toggleSong(idx);
          });

          this.songRows.push({ bg, text, name: songName, audioKey });
          stageRowY += rowHeight;
        }
      }
    }

    // VOLVER button
    this._createButton(60, GAME_HEIGHT - 20, 'VOLVER', () => this._goBack());

    this.transitioning = false;
    this.selectedIndex = 0;

    // Global navigation bindings
    this.events.on('wake', this._bindNavEvents, this);
    this.events.on('sleep', this._unbindNavEvents, this);
    this.events.on('shutdown', this._unbindNavEvents, this);
    this._bindNavEvents();
    this._updateSelection();
  }

  _bindNavEvents() {
    this._unbindNavEvents();
    const e = this.game.events;
    e.on('ui_up', this._navUp, this);
    e.on('ui_down', this._navDown, this);
    e.on('ui_confirm', this._navConfirm, this);
    e.on('ui_cancel', this._goBack, this);
  }

  _unbindNavEvents() {
    const e = this.game.events;
    e.off('ui_up', this._navUp, this);
    e.off('ui_down', this._navDown, this);
    e.off('ui_confirm', this._navConfirm, this);
    e.off('ui_cancel', this._goBack, this);
  }

  _navUp() {
    if (this.transitioning) return;
    this.selectedIndex--;
    if (this.selectedIndex < 0) this.selectedIndex = this.songRows.length - 1;
    this._updateSelection();
    this.game.audioManager.play('ui_navigate');
  }

  _navDown() {
    if (this.transitioning) return;
    this.selectedIndex++;
    if (this.selectedIndex >= this.songRows.length) this.selectedIndex = 0;
    this._updateSelection();
    this.game.audioManager.play('ui_navigate');
  }

  _navConfirm() {
    if (this.transitioning) return;
    this.game.audioManager.play('ui_confirm');
    this._toggleSong(this.selectedIndex);
  }

  _updateSelection() {
    this.songRows.forEach((row, index) => {
      const isSelected = index === this.selectedIndex;
      if (isSelected) {
        row.bg.setStrokeStyle(2, 0xffcc00);
        if (this.playingIndex !== index) row.text.setColor('#ffcc00');
      } else {
        row.bg.setStrokeStyle(1, 0x4444aa);
        if (this.playingIndex !== index) row.text.setColor('#ffffff');
      }
    });
  }

  _toggleSong(index) {
    const audio = this.game.audioManager;

    if (this.playingIndex === index) {
      // Stop current song
      audio.stopMusic();
      this._clearHighlight(index);
      this.playingIndex = -1;
    } else {
      // Clear previous highlight
      if (this.playingIndex >= 0) {
        this._clearHighlight(this.playingIndex);
      }
      // Play new song
      audio.playMusic(this.songRows[index].audioKey);
      this._setHighlight(index);
      this.playingIndex = index;
    }
  }

  _setHighlight(index) {
    const row = this.songRows[index];
    row.bg.setFillStyle(0x443322);
    row.bg.setStrokeStyle(1, 0xffcc00);
    row.text.setText(`▶ ${row.name}`);
    row.text.setColor('#ffcc00');
  }

  _clearHighlight(index) {
    const row = this.songRows[index];
    row.bg.setFillStyle(0x222244);
    row.bg.setStrokeStyle(1, 0x4444aa);
    row.text.setText(row.name);
    row.text.setColor('#ffffff');
  }

  _createButton(x, y, label, callback) {
    const bg = this.add
      .rectangle(x, y, 100, 22, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });

    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Arial',
        fontSize: '12px',
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
      this.game.audioManager.play('ui_confirm');
      callback();
    });
  }

  _goBack() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.game.audioManager.stopMusic();
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('TitleScene');
    });
  }
}
