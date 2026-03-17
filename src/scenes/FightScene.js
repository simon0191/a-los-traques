import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT, GROUND_Y, STAGE_LEFT, STAGE_RIGHT,
  MAX_HP, MAX_SPECIAL, ROUNDS_TO_WIN, FIGHTER_COLORS
} from '../config.js';
import { Fighter } from '../entities/Fighter.js';
import { InputManager } from '../systems/InputManager.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { AIController } from '../systems/AIController.js';
import { DevConsole } from '../systems/DevConsole.js';
import fightersData from '../data/fighters.json';

// ---------------------------------------------------------------------------
// HUD layout constants
// ---------------------------------------------------------------------------
const BAR_W = 160;
const BAR_H = 10;
const BAR_Y = 12;
const BAR_P1_X = 16;
const BAR_P2_X = GAME_WIDTH - 16 - BAR_W;

const SPECIAL_BAR_W = 100;
const SPECIAL_BAR_H = 6;
const SPECIAL_BAR_Y = BAR_Y + BAR_H + 4;
const SPECIAL_P1_X = BAR_P1_X;
const SPECIAL_P2_X = GAME_WIDTH - 16 - SPECIAL_BAR_W;

export class FightScene extends Phaser.Scene {
  constructor() {
    super({ key: 'FightScene' });
  }

  // =========================================================================
  // INIT - receive data from character select (or use defaults)
  // =========================================================================
  init(data) {
    // Accept both string IDs (from PreFightScene) and numeric indices
    if (data && data.p1Id) {
      this.p1Id = data.p1Id;
      this.p2Id = data.p2Id;
    } else {
      this.p1Id = fightersData[data && data.p1 != null ? data.p1 : 0].id;
      this.p2Id = fightersData[data && data.p2 != null ? data.p2 : 1].id;
    }
    this.stageId = data && (data.stageId || data.stage) ? (data.stageId || data.stage) : null;
    this.aiDifficulty = (data && data.difficulty) ? data.difficulty : 'medium';
    this.gameMode = (data && data.gameMode) || 'local';
    this.networkManager = (data && data.networkManager) || null;
  }

  // =========================================================================
  // CREATE
  // =========================================================================
  create() {
    // -- Load fighter data by ID --
    this.p1Data = fightersData.find(f => f.id === this.p1Id) || fightersData[0];
    this.p2Data = fightersData.find(f => f.id === this.p2Id) || fightersData[1];

    // -- Draw background --
    this._createBackground();

    // -- Create Fighter entities --
    const p1Tex = this.textures.exists(`fighter_${this.p1Id}_idle`) ? `fighter_${this.p1Id}_idle` : 'fighter_p1';
    const p2Tex = this.textures.exists(`fighter_${this.p2Id}_idle`) ? `fighter_${this.p2Id}_idle` : 'fighter_p2';
    this.p1Fighter = new Fighter(
      this, GAME_WIDTH * 0.3, GROUND_Y, p1Tex, this.p1Data, 0
    );
    this.p2Fighter = new Fighter(
      this, GAME_WIDTH * 0.7, GROUND_Y, p2Tex, this.p2Data, 1
    );

    // -- Systems --
    this.inputManager = new InputManager(this);
    this.combat = new CombatSystem(this);

    // -- Projectiles array --
    this.projectiles = [];

    // -- Build HUD --
    this._createHUD();

    // -- AI controller (local mode only) --
    if (this.gameMode !== 'online') {
      this.aiController = new AIController(this, this.p2Fighter, this.p1Fighter, this.aiDifficulty);
    } else {
      this.aiController = null;
      this.frameCounter = 0;
      this._setupOnlineMode();
    }

    // -- Audio --
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.playMusic('bgm_fight');
    audio.createMuteButton(this);

    // -- Dev console (backtick to toggle) --
    DevConsole._AIController = AIController;
    this.devConsole = new DevConsole(this);

    // -- Space key for restart --
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // -- Start first round intro --
    this._showRoundIntro();
  }

  // =========================================================================
  // UPDATE
  // =========================================================================
  update(time, delta) {
    // Always update fighters (gravity, timers, ground check)
    this.p1Fighter.update(time, delta);
    this.p2Fighter.update(time, delta);

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.update(delta);
      if (!proj.active) {
        this.projectiles.splice(i, 1);
      }
    }

    if (!this.combat.roundActive) {
      // Allow restart after match over
      if (this.combat.matchOver && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
        this.scene.restart();
      }
      return;
    }

    if (this.gameMode === 'online') {
      // Online: _handleOnlineUpdate does facing, hit detection (host only),
      // state sync, and HUD update internally
      this._handleOnlineUpdate(time, delta);
    } else {
      // -- Handle P1 input --
      this._handleP1Input();

      // -- Handle P2 AI --
      if (this.aiController) {
        this.aiController.update(time, delta);
        this.aiController.applyDecisions();
      }

      // -- Body collision (push-back) --
      this.combat.resolveBodyCollision(this.p1Fighter, this.p2Fighter);

      // -- Facing --
      this.p1Fighter.faceOpponent(this.p2Fighter);
      this.p2Fighter.faceOpponent(this.p1Fighter);

      // -- Hit detection (both directions) --
      this.combat.checkHit(this.p1Fighter, this.p2Fighter);
      this.combat.checkHit(this.p2Fighter, this.p1Fighter);

      // -- Update HUD --
      this._updateHUD();
    }
  }

  // =========================================================================
  // BACKGROUND
  // =========================================================================
  _createBackground() {
    // Default background
    let bgColor = 0x1a1a2e;
    let groundColor = 0x2d2d44;

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, bgColor);
    this.add.rectangle(GAME_WIDTH / 2, GROUND_Y + 25, GAME_WIDTH, 50, groundColor);

    // Stage boundary lines (subtle)
    this.add.rectangle(STAGE_LEFT, GROUND_Y, 2, 20, 0x444466).setOrigin(0.5, 1).setAlpha(0.3);
    this.add.rectangle(STAGE_RIGHT, GROUND_Y, 2, 20, 0x444466).setOrigin(0.5, 1).setAlpha(0.3);
  }

  // =========================================================================
  // HUD
  // =========================================================================
  _createHUD() {
    const depth = 20;

    // --- Health bars ---
    // P1 health (fills from left to right)
    this.hpBgP1 = this.add.rectangle(BAR_P1_X, BAR_Y, BAR_W, BAR_H, 0x333333)
      .setOrigin(0, 0).setDepth(depth);
    this.hpBarP1 = this.add.rectangle(BAR_P1_X, BAR_Y, BAR_W, BAR_H, 0x00cc44)
      .setOrigin(0, 0).setDepth(depth + 1);
    this.add.rectangle(BAR_P1_X + BAR_W / 2, BAR_Y + BAR_H / 2, BAR_W + 2, BAR_H + 2)
      .setStrokeStyle(1, 0xffffff).setFillStyle().setDepth(depth + 2);

    // P2 health (fills from right to left)
    this.hpBgP2 = this.add.rectangle(BAR_P2_X, BAR_Y, BAR_W, BAR_H, 0x333333)
      .setOrigin(0, 0).setDepth(depth);
    this.hpBarP2 = this.add.rectangle(BAR_P2_X + BAR_W, BAR_Y, BAR_W, BAR_H, 0xcc2200)
      .setOrigin(1, 0).setDepth(depth + 1);
    this.add.rectangle(BAR_P2_X + BAR_W / 2, BAR_Y + BAR_H / 2, BAR_W + 2, BAR_H + 2)
      .setStrokeStyle(1, 0xffffff).setFillStyle().setDepth(depth + 2);

    // --- Special meter bars ---
    // P1 special
    this.spBgP1 = this.add.rectangle(SPECIAL_P1_X, SPECIAL_BAR_Y, SPECIAL_BAR_W, SPECIAL_BAR_H, 0x222222)
      .setOrigin(0, 0).setDepth(depth);
    this.spBarP1 = this.add.rectangle(SPECIAL_P1_X, SPECIAL_BAR_Y, 0, SPECIAL_BAR_H, 0xffcc00)
      .setOrigin(0, 0).setDepth(depth + 1);
    this.add.rectangle(SPECIAL_P1_X + SPECIAL_BAR_W / 2, SPECIAL_BAR_Y + SPECIAL_BAR_H / 2, SPECIAL_BAR_W + 2, SPECIAL_BAR_H + 2)
      .setStrokeStyle(1, 0x666666).setFillStyle().setDepth(depth + 2);

    // P2 special
    this.spBgP2 = this.add.rectangle(SPECIAL_P2_X, SPECIAL_BAR_Y, SPECIAL_BAR_W, SPECIAL_BAR_H, 0x222222)
      .setOrigin(0, 0).setDepth(depth);
    this.spBarP2 = this.add.rectangle(SPECIAL_P2_X + SPECIAL_BAR_W, SPECIAL_BAR_Y, 0, SPECIAL_BAR_H, 0xffcc00)
      .setOrigin(1, 0).setDepth(depth + 1);
    this.add.rectangle(SPECIAL_P2_X + SPECIAL_BAR_W / 2, SPECIAL_BAR_Y + SPECIAL_BAR_H / 2, SPECIAL_BAR_W + 2, SPECIAL_BAR_H + 2)
      .setStrokeStyle(1, 0x666666).setFillStyle().setDepth(depth + 2);

    // --- Player name labels ---
    const p1Color = this.p1Data.color.replace('0x', '#');
    const p2Color = this.p2Data.color.replace('0x', '#');

    this.add.text(BAR_P1_X, BAR_Y - 11, this.p1Data.name, {
      fontSize: '9px', fontFamily: 'monospace', color: p1Color,
      stroke: '#000000', strokeThickness: 2
    }).setDepth(depth + 3);

    this.add.text(BAR_P2_X + BAR_W, BAR_Y - 11, this.p2Data.name, {
      fontSize: '9px', fontFamily: 'monospace', color: p2Color,
      stroke: '#000000', strokeThickness: 2
    }).setOrigin(1, 0).setDepth(depth + 3);

    // --- Timer display (center top) ---
    this.timerText = this.add.text(GAME_WIDTH / 2, BAR_Y + 2, '60', {
      fontSize: '18px', fontFamily: 'monospace', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5, 0).setDepth(depth + 3);

    // --- Round indicators (dots below timer) ---
    this.roundDotsP1 = [];
    this.roundDotsP2 = [];
    const dotY = BAR_Y + 24;
    const dotSpacing = 10;
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      const p1Dot = this.add.circle(
        GAME_WIDTH / 2 - 20 - (i * dotSpacing), dotY, 3, 0x333333
      ).setDepth(depth + 3).setStrokeStyle(1, 0x666666);
      this.roundDotsP1.push(p1Dot);

      const p2Dot = this.add.circle(
        GAME_WIDTH / 2 + 20 + (i * dotSpacing), dotY, 3, 0x333333
      ).setDepth(depth + 3).setStrokeStyle(1, 0x666666);
      this.roundDotsP2.push(p2Dot);
    }

    // --- Center text (for announcements) ---
    this.centerText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '', {
      fontSize: '28px', fontFamily: 'monospace', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(30);

    this.subtitleText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 5, '', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ffcc00',
      stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setDepth(30);
  }

  _updateHUD() {
    // Health bars
    const ratioP1 = Phaser.Math.Clamp(this.p1Fighter.hp / MAX_HP, 0, 1);
    const ratioP2 = Phaser.Math.Clamp(this.p2Fighter.hp / MAX_HP, 0, 1);

    this.hpBarP1.width = BAR_W * ratioP1;
    this.hpBarP2.width = BAR_W * ratioP2;

    // Color shifts as HP drops
    if (ratioP1 < 0.3) this.hpBarP1.setFillStyle(0xff4444);
    else if (ratioP1 < 0.6) this.hpBarP1.setFillStyle(0xffaa00);
    else this.hpBarP1.setFillStyle(0x00cc44);

    if (ratioP2 < 0.3) this.hpBarP2.setFillStyle(0xff4444);
    else if (ratioP2 < 0.6) this.hpBarP2.setFillStyle(0xffaa00);
    else this.hpBarP2.setFillStyle(0xcc2200);

    // Special bars
    const spRatioP1 = Phaser.Math.Clamp(this.p1Fighter.special / MAX_SPECIAL, 0, 1);
    const spRatioP2 = Phaser.Math.Clamp(this.p2Fighter.special / MAX_SPECIAL, 0, 1);
    this.spBarP1.width = SPECIAL_BAR_W * spRatioP1;
    this.spBarP2.width = SPECIAL_BAR_W * spRatioP2;

    // Flash special bar when full
    if (spRatioP1 >= 1) this.spBarP1.setFillStyle(0xffff00);
    else this.spBarP1.setFillStyle(0xffcc00);
    if (spRatioP2 >= 1) this.spBarP2.setFillStyle(0xffff00);
    else this.spBarP2.setFillStyle(0xffcc00);

    // Timer
    this.timerText.setText(String(Math.max(0, this.combat.timer)));
    if (this.combat.timer <= 10) {
      this.timerText.setColor('#ff4444');
    } else {
      this.timerText.setColor('#ffffff');
    }

    // Round dots
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      this.roundDotsP1[i].setFillStyle(i < this.combat.p1RoundsWon ? 0x00cc44 : 0x333333);
      this.roundDotsP2[i].setFillStyle(i < this.combat.p2RoundsWon ? 0xcc2200 : 0x333333);
    }
  }

  // =========================================================================
  // P1 INPUT
  // =========================================================================
  _handleP1Input() {
    // Skip keyboard input when dev console is open
    if (this.devConsole && this.devConsole.visible) {
      this.p1Fighter.stop();
      return;
    }

    const input = this.inputManager;
    const fighter = this.p1Fighter;
    const speed = 80 + (fighter.data.stats.speed * 20); // speed stat: 1=100, 3=140, 5=180

    // Movement
    if (input.left) {
      fighter.moveLeft(speed);
    } else if (input.right) {
      fighter.moveRight(speed);
    } else {
      fighter.stop();
    }

    // Jump (+ double jump if already airborne)
    if (input.up) {
      fighter.jump();
    }

    // Block (down while on ground)
    if (input.block && fighter.isOnGround) {
      fighter.block();
    }

    // Attacks
    if (input.lightPunch) fighter.attack('lightPunch');
    else if (input.heavyPunch) fighter.attack('heavyPunch');
    else if (input.lightKick) fighter.attack('lightKick');
    else if (input.heavyKick) fighter.attack('heavyKick');
    else if (input.special) fighter.attack('special');

    // Consume one-shot touch inputs
    input.consumeTouch();
  }

  // =========================================================================
  // ONLINE MODE
  // =========================================================================
  _setupOnlineMode() {
    const nm = this.networkManager;
    const slot = nm.getPlayerSlot();

    // slot 0 = host (runs authoritative combat), slot 1 = guest (receives state)
    this.isHost = slot === 0;

    // Determine which fighter is local vs remote
    this.localFighter = slot === 0 ? this.p1Fighter : this.p2Fighter;
    this.remoteFighter = slot === 0 ? this.p2Fighter : this.p1Fighter;

    // Sync counter: host sends state every N frames
    this._syncInterval = 3;

    nm.onDisconnect(() => {
      this.combat.roundActive = false;
      this._onlineDisconnected = true;
      this.centerText.setText('DESCONECTADO');
      this.subtitleText.setText('Oponente abandono la pelea');
      this.localFighter.stop();
      this.remoteFighter.stop();
    });

    // Guest: receive authoritative state syncs from host
    if (!this.isHost) {
      nm.onSync((msg) => {
        // Apply authoritative HP, special, timer, positions
        this.p1Fighter.hp = msg.p1hp;
        this.p1Fighter.special = msg.p1sp;
        this.p2Fighter.hp = msg.p2hp;
        this.p2Fighter.special = msg.p2sp;
        this.combat.timer = msg.timer;
        // Sync positions to prevent drift
        this.p1Fighter.sprite.x = msg.p1x;
        this.p2Fighter.sprite.x = msg.p2x;
      });

      nm.onRoundEvent((msg) => {
        // Host tells us about round outcomes
        this.combat.stopRound();
        this.combat.p1RoundsWon = msg.p1Rounds;
        this.combat.p2RoundsWon = msg.p2Rounds;
        this.combat.roundNumber = msg.roundNumber;

        if (msg.event === 'ko' || msg.event === 'timeup') {
          if (msg.matchOver) {
            this.combat.matchOver = true;
            this.onMatchOver(msg.winnerIndex);
          } else {
            this.onRoundOver(msg.winnerIndex);
          }
        }
      });
    }
  }

  _handleOnlineUpdate(time, delta) {
    this.frameCounter++;
    const nm = this.networkManager;

    // Read local input and send it
    const input = this.inputManager;
    const localInput = {
      left: input.left,
      right: input.right,
      up: input.up,
      down: input.down,
      lp: input.lightPunch,
      hp: input.heavyPunch,
      lk: input.lightKick,
      hk: input.heavyKick,
      sp: input.special
    };

    nm.sendInput(this.frameCounter, localInput);

    // Apply local input to local fighter
    this._applyInputToFighter(this.localFighter, localInput);
    input.consumeTouch();

    // Apply remote input to remote fighter
    const remoteInput = nm.getRemoteInput(this.frameCounter);
    this._applyInputToFighter(this.remoteFighter, remoteInput);

    // Body collision (push-back)
    this.combat.resolveBodyCollision(this.p1Fighter, this.p2Fighter);

    // Facing (both sides)
    this.p1Fighter.faceOpponent(this.p2Fighter);
    this.p2Fighter.faceOpponent(this.p1Fighter);

    // Host: run hit detection and send state syncs
    if (this.isHost) {
      this.combat.checkHit(this.p1Fighter, this.p2Fighter);
      this.combat.checkHit(this.p2Fighter, this.p1Fighter);

      // Send periodic state sync
      if (this.frameCounter % this._syncInterval === 0) {
        nm.sendSync({
          p1hp: this.p1Fighter.hp,
          p1sp: this.p1Fighter.special,
          p2hp: this.p2Fighter.hp,
          p2sp: this.p2Fighter.special,
          timer: this.combat.timer,
          p1x: this.p1Fighter.sprite.x,
          p2x: this.p2Fighter.sprite.x
        });
      }
    }

    this._updateHUD();
  }

  /** Send round event from host to guest via network */
  _sendRoundEvent(event, winnerIndex) {
    if (this.gameMode === 'online' && this.isHost && this.networkManager) {
      this.networkManager.sendRoundEvent({
        event,
        winnerIndex,
        p1Rounds: this.combat.p1RoundsWon,
        p2Rounds: this.combat.p2RoundsWon,
        roundNumber: this.combat.roundNumber,
        matchOver: this.combat.matchOver
      });
    }
  }

  _applyInputToFighter(fighter, inputState) {
    const speed = 80 + (fighter.data.stats.speed * 20);

    if (inputState.left) {
      fighter.moveLeft(speed);
    } else if (inputState.right) {
      fighter.moveRight(speed);
    } else {
      fighter.stop();
    }

    if (inputState.up) {
      fighter.jump();
    }

    if (inputState.down && fighter.isOnGround) fighter.block();

    if (inputState.lp) fighter.attack('lightPunch');
    else if (inputState.hp) fighter.attack('heavyPunch');
    else if (inputState.lk) fighter.attack('lightKick');
    else if (inputState.hk) fighter.attack('heavyKick');
    else if (inputState.sp) fighter.attack('special');
  }

  // =========================================================================
  // ROUND FLOW
  // =========================================================================
  _showRoundIntro() {
    this.combat.roundActive = false;

    this.centerText.setText(`ROUND ${this.combat.roundNumber}`);
    this.subtitleText.setText('');
    this.game.audioManager.play('announce_round');

    // Scale-up + fade-in tween for round text
    this.centerText.setScale(2.5).setAlpha(0);
    this.tweens.add({
      targets: this.centerText,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 400,
      ease: 'Back.easeOut'
    });

    this.time.delayedCall(1500, () => {
      this.centerText.setText('A PELEAR!');
      this.game.audioManager.play('announce_fight');
      this.centerText.setScale(2).setAlpha(0);
      this.tweens.add({
        targets: this.centerText,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut'
      });
      this.time.delayedCall(800, () => {
        this.centerText.setText('');
        this.subtitleText.setText('');
        this.combat.startRound();
      });
    });
  }

  /**
   * Called by CombatSystem when a round ends but match is not over.
   * @param {number} winnerIndex - 0 for P1, 1 for P2
   */
  onRoundOver(winnerIndex) {
    // Host sends round event to guest
    this._sendRoundEvent('ko', winnerIndex);

    const winnerName = winnerIndex === 0 ? this.p1Data.name : this.p2Data.name;

    this.centerText.setText('K.O.!');
    this.subtitleText.setText('');
    this.game.audioManager.play('announce_ko');

    // Scale-up tween for KO text
    this.centerText.setScale(3).setAlpha(0);
    this.tweens.add({
      targets: this.centerText,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 350,
      ease: 'Back.easeOut'
    });

    // Stop AI movement
    this.p1Fighter.stop();
    this.p2Fighter.stop();

    this.time.delayedCall(1500, () => {
      this.centerText.setText(`${winnerName} GANA EL ROUND!`);
      this.centerText.setScale(1).setAlpha(1);
      this.subtitleText.setText(
        `RONDAS: ${this.combat.p1RoundsWon} - ${this.combat.p2RoundsWon}`
      );

      this.time.delayedCall(2000, () => {
        // Reset fighters for next round (keep round score, reset HP/position)
        this.p1Fighter.reset(GAME_WIDTH * 0.3);
        this.p2Fighter.reset(GAME_WIDTH * 0.7);
        this._updateHUD();
        this._showRoundIntro();
      });
    });
  }

  /**
   * Called by CombatSystem when the match is over (someone won enough rounds).
   * @param {number} winnerIndex - 0 for P1, 1 for P2
   */
  onMatchOver(winnerIndex) {
    // Host sends match-over event to guest
    this._sendRoundEvent('ko', winnerIndex);

    const winnerData = winnerIndex === 0 ? this.p1Data : this.p2Data;
    const loserData = winnerIndex === 0 ? this.p2Data : this.p1Data;

    // Stop AI
    if (this.aiController) {
      this.aiController.destroy();
      this.aiController = null;
    }

    this.p1Fighter.stop();
    this.p2Fighter.stop();

    this.centerText.setText('K.O.!');
    this.subtitleText.setText('');
    this.game.audioManager.play('announce_ko');

    // Scale-up tween for final KO text
    this.centerText.setScale(3).setAlpha(0);
    this.tweens.add({
      targets: this.centerText,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 350,
      ease: 'Back.easeOut'
    });

    this.time.delayedCall(2000, () => {
      this.cameras.main.fadeOut(500, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('VictoryScene', {
          winnerId: winnerData.id,
          loserId: loserData.id,
          p1Id: this.p1Id,
          p2Id: this.p2Id,
          stageId: this.stageId,
          gameMode: this.gameMode,
          networkManager: this.networkManager
        });
      });
    });
  }

  // =========================================================================
  // VISUAL EFFECTS
  // =========================================================================

  /**
   * Spawn a burst of small rectangles at the hit point.
   * @param {number} x
   * @param {number} y
   * @param {'light'|'heavy'|'special'} intensity
   */
  spawnHitSpark(x, y, intensity) {
    const count = intensity === 'special' ? 12 : intensity === 'heavy' ? 8 : 5;
    const colors = intensity === 'special'
      ? [0xffcc00, 0xff6600, 0xffffff]
      : [0xffffff, 0xffccaa];
    const spread = intensity === 'special' ? 40 : intensity === 'heavy' ? 30 : 20;

    for (let i = 0; i < count; i++) {
      const spark = this.add.rectangle(
        x, y,
        Phaser.Math.Between(2, 5),
        Phaser.Math.Between(2, 5),
        Phaser.Utils.Array.GetRandom(colors)
      ).setDepth(15);

      this.tweens.add({
        targets: spark,
        x: x + Phaser.Math.Between(-spread, spread),
        y: y + Phaser.Math.Between(-spread, spread * 0.3),
        alpha: 0,
        scaleX: 0,
        scaleY: 0,
        duration: Phaser.Math.Between(150, 300),
        onComplete: () => spark.destroy()
      });
    }
  }

  /**
   * Flash a white overlay across the screen (used for KO moments).
   */
  flashScreen() {
    const flash = this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2,
      GAME_WIDTH, GAME_HEIGHT,
      0xffffff
    ).setDepth(50).setAlpha(0.6);

    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 300,
      onComplete: () => flash.destroy()
    });
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================
  shutdown() {
    if (this.combat) this.combat.stopRound();
    if (this.aiController) this.aiController.destroy();
    // Destroy projectiles
    for (const proj of this.projectiles) {
      proj.destroy();
    }
    this.projectiles = [];
  }
}
