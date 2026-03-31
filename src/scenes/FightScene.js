import Phaser from 'phaser';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  GROUND_Y,
  MAX_HP,
  ROUNDS_TO_WIN,
  STAGE_LEFT,
  STAGE_RIGHT,
} from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';
import { Fighter } from '../entities/Fighter.js';
import { tick } from '../simulation/SimulationEngine.js';
import { AIController } from '../systems/AIController.js';
import { AudioBridge } from '../systems/AudioBridge.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { DevConsole } from '../systems/DevConsole.js';
import { FightRecorder } from '../systems/FightRecorder.js';
import {
  FP_SCALE,
  MAX_SPECIAL_FP,
  MAX_STAMINA_FP,
  ONLINE_INPUT_DELAY_FRAMES,
} from '../systems/FixedPoint.js';
import { encodeInput } from '../systems/InputBuffer.js';
import { InputManager } from '../systems/InputManager.js';
import { Logger, LogLevel } from '../systems/Logger.js';
import { MatchEvent, MatchState, MatchStateMachine } from '../systems/MatchStateMachine.js';
import { MatchTelemetry } from '../systems/MatchTelemetry.js';
import { ReconnectionManager } from '../systems/ReconnectionManager.js';
import { ReplayInputSource } from '../systems/ReplayInputSource.js';
import { RollbackManager } from '../systems/RollbackManager.js';
import { simulateFrame as simFrame } from '../systems/SimulationStep.js';
import { TouchControls } from '../systems/TouchControls.js';
import { VFXBridge } from '../systems/VFXBridge.js';

// ---------------------------------------------------------------------------
// HUD layout constants
// ---------------------------------------------------------------------------
const log = Logger.create('FightScene');

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

const STAMINA_BAR_W = 100;
const STAMINA_BAR_H = 5;
const STAMINA_BAR_Y = SPECIAL_BAR_Y + SPECIAL_BAR_H + 3;
const STAMINA_P1_X = BAR_P1_X;
const STAMINA_P2_X = GAME_WIDTH - 16 - STAMINA_BAR_W;

export class FightScene extends Phaser.Scene {
  constructor() {
    super({ key: 'FightScene' });
  }

  get isPaused() {
    return this.matchState?.state === MatchState.PAUSED;
  }

  // =========================================================================
  // INIT - receive data from character select (or use defaults)
  // =========================================================================
  init(data) {
    // Accept both string IDs (from PreFightScene) and numeric indices
    if (data?.p1Id) {
      this.p1Id = data.p1Id;
      this.p2Id = data.p2Id;
    } else {
      this.p1Id = fightersData[data && data.p1 != null ? data.p1 : 0].id;
      this.p2Id = fightersData[data && data.p2 != null ? data.p2 : 1].id;
    }
    this.stageId = data && (data.stageId || data.stage) ? data.stageId || data.stage : null;
    this.aiDifficulty = data?.difficulty ? data.difficulty : 'medium';
    this.gameMode = data?.gameMode || 'local';
    this.networkManager = data?.networkManager || null;
    this.matchContext = data?.matchContext || null;
  }

  // =========================================================================
  // CREATE
  // =========================================================================
  create() {
    // -- Load fighter data by ID --
    this.p1Data = fightersData.find((f) => f.id === this.p1Id) || fightersData[0];
    this.p2Data = fightersData.find((f) => f.id === this.p2Id) || fightersData[1];

    // -- Draw background --
    this._createBackground();

    // -- Create Fighter entities --
    const p1Tex = this.textures.exists(`fighter_${this.p1Id}_idle`)
      ? `fighter_${this.p1Id}_idle`
      : 'fighter_p1';
    const p2Tex = this.textures.exists(`fighter_${this.p2Id}_idle`)
      ? `fighter_${this.p2Id}_idle`
      : 'fighter_p2';
    this.p1Fighter = new Fighter(this, GAME_WIDTH * 0.3, GROUND_Y, p1Tex, this.p1Data, 0);
    this.p2Fighter = new Fighter(this, GAME_WIDTH * 0.7, GROUND_Y, p2Tex, this.p2Data, 1);

    // -- Systems --
    this.combat = new CombatSystem(this);

    // -- Event bridges (Phase 3: events → audio/VFX) --
    this.audioBridge = new AudioBridge(this.game.audioManager);
    this.vfxBridge = new VFXBridge(
      this,
      () => this.p1Fighter,
      () => this.p2Fighter,
    );

    // -- Projectiles array --
    this.projectiles = [];

    // -- Active shouts tracking --
    this._activeShouts = [];

    // -- Build HUD --
    this._createHUD();

    // -- Dev console (backtick to toggle) --
    DevConsole._AIController = AIController;
    this.devConsole = new DevConsole(this);

    // -- Space key for restart --
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    if (this.gameMode === 'spectator') {
      // Spectator: no input, no AI
      this.inputManager = null;
      this.touchControls = null;
      this.aiController = null;
      this.frameCounter = 0;
      this._setupSpectatorMode();
    } else {
      const slot = this.gameMode === 'online' && this.networkManager ? this.networkManager.getPlayerSlot() : 0;
      this.inputManager = new InputManager(this);
      this.touchControls = new TouchControls(this, this.inputManager, slot);

      // -- AI controller (local mode only) --
      if (this.gameMode !== 'online') {
        // Replay mode: use recorded inputs instead of AI/keyboard
        if (this.game.autoplay?.replay && window.__REPLAY_BUNDLE) {
          const bundle = window.__REPLAY_BUNDLE;
          const totalFrames = Math.max(bundle.p1.totalFrames, bundle.p2.totalFrames);
          // Prefer confirmed input pairs (exact post-rollback inputs) over raw per-player inputs
          if (bundle.confirmedInputs?.length > 0) {
            const sources = ReplayInputSource.fromConfirmedInputs(
              bundle.confirmedInputs,
              totalFrames,
            );
            this._replayP1 = sources.p1;
            this._replayP2 = sources.p2;
          } else {
            this._replayP1 = new ReplayInputSource(bundle.p1.inputs, totalFrames);
            this._replayP2 = new ReplayInputSource(bundle.p2.inputs, totalFrames);
          }
          this._replayFrame = 0;
          this._replayRoundCooldown = 0;
          this.aiController = null;
        } else {
          if (this.p1Fighter && this.p2Fighter) {
            this.aiController = new AIController(
              this,
              this.p2Fighter,
              this.p1Fighter,
              this.aiDifficulty,
            );
          } else {
            console.error('[FightScene] Cannot initialize AI: fighters missing', {
              p1: !!this.p1Fighter,
              p2: !!this.p2Fighter,
            });
          }
        }
      } else {
        this.aiController = null;
        this.frameCounter = 0;
        this._setupOnlineMode();
      }
    }

    // -- Audio --
    const audio = this.game.audioManager;
    audio.setScene(this);
    const fightMusicCount = this.game.registry.get('fightMusicCount') || 1;
    const trackIndex = Math.floor(Math.random() * fightMusicCount);
    audio.playMusic(`bgm_fight_${trackIndex}`);
    audio.createMuteButton(this);

    // -- Pause system --
    this._pauseOverlay = null;
    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.escKey.on('down', () => this._togglePause());

    // -- Fixed-timestep accumulator for simulation --
    this._simAccumulator = 0;
    this._localFrame = 0;

    // -- Match state machine (RFC 0002 §2B.1) --
    const smInitialState =
      this.gameMode === 'online' ? MatchState.SYNCHRONIZING : MatchState.ROUND_INTRO;
    this.matchState = new MatchStateMachine(smInitialState);

    // -- Start first round intro --
    if (this._replayP1) {
      // Replay mode: skip intro animation, start round immediately with frame-based timer
      // (no time.addEvent timer — simulateFrame's tickTimer handles it)
      // Suppress direct KO/timeup handling — the replay loop handles round wins itself
      this.combat.suppressRoundEvents = true;
      this.combat.timer = 60;
      this.combat._timerAccumulator = 0;
      this.combat.roundActive = true;
      this.matchState.transition(MatchEvent.INTRO_COMPLETE);
      console.log(
        `[REPLAY] Starting replay: ${this.p1Data.id} vs ${this.p2Data.id}, totalFrames P1=${this._replayP1.totalFrames} P2=${this._replayP2.totalFrames}`,
      );
    } else if (this.gameMode === 'online') {
      // Online mode: prepare round state for frame-0 sync, but don't start simulation yet.
      // Both peers exchange frame-0 hashes in SYNCHRONIZING state.
      this.combat.startRound();
      this._startFrameZeroSync();
    } else {
      this._showRoundIntro();
    }

    // Triple-tap gesture to activate debug mode (top-right 60x40 region)
    if (this.gameMode === 'online' && !this.game.debugMode) {
      this._tripleTapTimes = [];
      this.input.on('pointerdown', (pointer) => {
        if (pointer.x > GAME_WIDTH - 60 && pointer.y < 40) {
          const now = Date.now();
          this._tripleTapTimes.push(now);
          // Keep only taps within the last 1 second
          this._tripleTapTimes = this._tripleTapTimes.filter((t) => now - t < 1000);
          if (this._tripleTapTimes.length >= 3) {
            this._tripleTapTimes = [];
            this._activateDebugMode();
          }
        }
      });
    }
  }

  _activateDebugMode() {
    if (this.game.debugMode) return;
    this.game.debugMode = true;
    Logger.setGlobalLevel(LogLevel.DEBUG);
    log.info('Debug mode activated via triple-tap');

    // Activate FightRecorder if not already running
    if (!this.recorder && this.networkManager) {
      const nm = this.networkManager;
      const slot = nm.getPlayerSlot();
      this.recorder = new FightRecorder({
        roomId: nm.roomId,
        playerSlot: slot,
        fighterId: slot === 0 ? this.p1Id : this.p2Id,
        opponentId: slot === 0 ? this.p2Id : this.p1Id,
        stageId: this.stageId,
        config: {},
      });
      // Wire recorder to rollback manager
      const origRollback = this.rollbackManager._onRollback;
      this.rollbackManager._onRollback = (frame, depth) => {
        this.recorder.recordRollback(frame, depth);
        if (origRollback) origRollback(frame, depth);
      };
      this.rollbackManager._onLocalChecksum = (frame, hash) =>
        this.recorder.recordChecksum(frame, hash);
      this.rollbackManager._onConfirmedInputs = (frame, p1, p2) =>
        this.recorder.recordConfirmedInputs(frame, p1, p2);
    }

    // Create debug overlay
    import('../systems/DebugOverlay.js').then(({ DebugOverlay }) => {
      const nm = this.networkManager;
      this.debugOverlay = new DebugOverlay(this, {
        getTelemetry: () => this.telemetry,
        getConnectionMonitor: () => nm.monitor,
        getTransportManager: () => nm.transport,
        getInputSync: () => nm.inputSync,
        getMatchState: () => this.matchState,
        onExportDebug: () => this._exportDebugBundle(),
        onExportAll: () => this._exportAllBundles(),
      });
    });
  }

  async _exportDebugBundle() {
    const { DebugBundleExporter } = await import('../systems/DebugBundleExporter.js');
    const bundle = DebugBundleExporter.generateBundle({
      recorder: this.recorder,
      telemetry: this.telemetry,
      matchState: this.matchState,
      sessionId: this.networkManager?.sessionId,
      debugMode: !!this.game.debugMode,
    });
    const copied = await DebugBundleExporter.copyToClipboard(bundle);
    if (this.debugOverlay) {
      this.debugOverlay.showToast(copied ? 'Copiado!' : 'Descargado!');
    }
  }

  async _exportAllBundles() {
    if (this.debugOverlay) this.debugOverlay.showToast('Recopilando...');
    const { DebugBundleExporter } = await import('../systems/DebugBundleExporter.js');

    // Auto-respond to debug requests from the other peer
    const nm = this.networkManager;
    nm.onDebugRequest(() => {
      const localBundle = DebugBundleExporter.generateBundle({
        recorder: this.recorder,
        telemetry: this.telemetry,
        matchState: this.matchState,
        sessionId: nm.sessionId,
        debugMode: !!this.game.debugMode,
      });
      nm.sendDebugResponse(localBundle);
    });

    const combined = await DebugBundleExporter.collectAll({
      generateLocalBundle: () =>
        DebugBundleExporter.generateBundle({
          recorder: this.recorder,
          telemetry: this.telemetry,
          matchState: this.matchState,
          sessionId: nm.sessionId,
          debugMode: !!this.game.debugMode,
        }),
      networkManager: nm,
    });
    const copied = await DebugBundleExporter.copyToClipboard(combined);
    if (this.debugOverlay) {
      this.debugOverlay.showToast(copied ? 'Copiado!' : 'Descargado!');
    }
  }

  // =========================================================================
  // UPDATE
  // =========================================================================
  update(time, delta) {
    if (this.isPaused) return;

    // Tick reconnection manager even while paused (for timeout detection)
    if (this.reconnectionManager) {
      this.reconnectionManager.tick();
    }

    // Skip game loop while reconnecting
    if (this.matchState.state === MatchState.RECONNECTING) {
      this._updateReconnectingOverlay();
      return;
    }

    // Skip game loop while waiting for frame-0 sync (RFC 0002 §2B.3)
    if (this.matchState.state === MatchState.SYNCHRONIZING) {
      return;
    }

    // Update projectiles (delta-based, visual rate)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.update(delta);
      if (!proj.active) {
        this.projectiles.splice(i, 1);
      }
    }

    // Update touch controls each frame (visual rate for responsive input)
    if (this.touchControls) this.touchControls.update();

    if (this.gameMode === 'spectator') {
      // Spectator: apply remote inputs for animation, update HUD, no combat
      if (this.combat.roundActive) {
        this._handleSpectatorUpdate();
      }
      this.p1Fighter.syncSprite();
      this.p2Fighter.syncSprite();
      this._updateHUD();
      return;
    }

    if (!this.combat.roundActive && this.combat.matchOver) {
      // Allow restart after match over (Space key or tap) — local mode only
      if (
        this.gameMode !== 'online' &&
        this.spaceKey &&
        Phaser.Input.Keyboard.JustDown(this.spaceKey)
      ) {
        this.scene.restart();
      }
      // Online/spectator wait for VictoryScene transition; local stays for space key
      if (this.gameMode !== 'online' && !this._replayP1) return;
    }
    // When round is not active but match is not over, keep running tick()
    // so the frame-based transitionTimer counts down and resets the round.

    // Fixed-timestep accumulator: gate simulation to exactly 60fps
    const FIXED_DELTA = 1000 / 60; // 16.667ms
    // Overclock: in autoplay mode, inject extra time to run more sim steps per frame
    const speed = this.game.autoplay?.speed || 1;
    this._simAccumulator += delta * speed;
    // Cap to prevent spiral of death (e.g. tab was backgrounded)
    const maxSteps = Math.max(4, speed);
    if (this._simAccumulator > FIXED_DELTA * maxSteps) {
      this._simAccumulator = FIXED_DELTA * maxSteps;
    }

    while (this._simAccumulator >= FIXED_DELTA) {
      this._simAccumulator -= FIXED_DELTA;
      if (this.gameMode === 'online') {
        this._handleOnlineUpdate(time, delta);
      } else {
        this._handleLocalUpdate(time, delta);
      }
    }

    // Sync sprites + animations + HUD at visual rate (after all sim ticks)
    this.p1Fighter.syncSprite();
    this.p2Fighter.syncSprite();
    this.p1Fighter.updateAnimation();
    this.p2Fighter.updateAnimation();
    this._updateHUD();
  }

  // =========================================================================
  // BACKGROUND
  // =========================================================================
  _createBackground() {
    const stage = stagesData.find((s) => s.id === this.stageId) || stagesData[0];

    // Main background image
    this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, stage.texture)
      .setOrigin(0.5)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    // Optional: Add a subtle overlay to help fighters pop
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.15);

    // Ground (subtle colored rectangle to ground the characters)
    const groundColor = Phaser.Display.Color.HexStringToColor(stage.groundColor).color;
    this.add.rectangle(GAME_WIDTH / 2, GROUND_Y + 25, GAME_WIDTH, 50, groundColor, 0.4).setDepth(1);

    // Stage boundary lines (subtle)
    this.add
      .rectangle(STAGE_LEFT, GROUND_Y, 2, 20, 0xffffff)
      .setOrigin(0.5, 1)
      .setAlpha(0.2)
      .setDepth(1);
    this.add
      .rectangle(STAGE_RIGHT, GROUND_Y, 2, 20, 0xffffff)
      .setOrigin(0.5, 1)
      .setAlpha(0.2)
      .setDepth(1);
  }

  // =========================================================================
  // HUD
  // =========================================================================
  _createHUD() {
    const depth = 20;

    // --- Health bars ---
    // P1 health (fills from left to right)
    this.hpBgP1 = this.add
      .rectangle(BAR_P1_X, BAR_Y, BAR_W, BAR_H, 0x333333)
      .setOrigin(0, 0)
      .setDepth(depth);
    this.hpBarP1 = this.add
      .rectangle(BAR_P1_X, BAR_Y, BAR_W, BAR_H, 0x00cc44)
      .setOrigin(0, 0)
      .setDepth(depth + 1);
    this.add
      .rectangle(BAR_P1_X + BAR_W / 2, BAR_Y + BAR_H / 2, BAR_W + 2, BAR_H + 2)
      .setStrokeStyle(1, 0xffffff)
      .setFillStyle()
      .setDepth(depth + 2);

    // P2 health (fills from right to left)
    this.hpBgP2 = this.add
      .rectangle(BAR_P2_X, BAR_Y, BAR_W, BAR_H, 0x333333)
      .setOrigin(0, 0)
      .setDepth(depth);
    this.hpBarP2 = this.add
      .rectangle(BAR_P2_X + BAR_W, BAR_Y, BAR_W, BAR_H, 0xcc2200)
      .setOrigin(1, 0)
      .setDepth(depth + 1);
    this.add
      .rectangle(BAR_P2_X + BAR_W / 2, BAR_Y + BAR_H / 2, BAR_W + 2, BAR_H + 2)
      .setStrokeStyle(1, 0xffffff)
      .setFillStyle()
      .setDepth(depth + 2);

    // --- Special meter bars ---
    // P1 special
    this.spBgP1 = this.add
      .rectangle(SPECIAL_P1_X, SPECIAL_BAR_Y, SPECIAL_BAR_W, SPECIAL_BAR_H, 0x222222)
      .setOrigin(0, 0)
      .setDepth(depth);
    this.spBarP1 = this.add
      .rectangle(SPECIAL_P1_X, SPECIAL_BAR_Y, 0, SPECIAL_BAR_H, 0xffcc00)
      .setOrigin(0, 0)
      .setDepth(depth + 1);
    this.add
      .rectangle(
        SPECIAL_P1_X + SPECIAL_BAR_W / 2,
        SPECIAL_BAR_Y + SPECIAL_BAR_H / 2,
        SPECIAL_BAR_W + 2,
        SPECIAL_BAR_H + 2,
      )
      .setStrokeStyle(1, 0x666666)
      .setFillStyle()
      .setDepth(depth + 2);
    // 50% marker P1
    this.add
      .rectangle(SPECIAL_P1_X + SPECIAL_BAR_W / 2, SPECIAL_BAR_Y + SPECIAL_BAR_H / 2, 1, SPECIAL_BAR_H, 0xffffff, 0.3)
      .setDepth(depth + 2);

    // P2 special
    this.spBgP2 = this.add
      .rectangle(SPECIAL_P2_X, SPECIAL_BAR_Y, SPECIAL_BAR_W, SPECIAL_BAR_H, 0x222222)
      .setOrigin(0, 0)
      .setDepth(depth);
    this.spBarP2 = this.add
      .rectangle(SPECIAL_P2_X + SPECIAL_BAR_W, SPECIAL_BAR_Y, 0, SPECIAL_BAR_H, 0xffcc00)
      .setOrigin(1, 0)
      .setDepth(depth + 1);
    this.add
      .rectangle(
        SPECIAL_P2_X + SPECIAL_BAR_W / 2,
        SPECIAL_BAR_Y + SPECIAL_BAR_H / 2,
        SPECIAL_BAR_W + 2,
        SPECIAL_BAR_H + 2,
      )
      .setStrokeStyle(1, 0x666666)
      .setFillStyle()
      .setDepth(depth + 2);
    // 50% marker P2
    this.add
      .rectangle(SPECIAL_P2_X + SPECIAL_BAR_W / 2, SPECIAL_BAR_Y + SPECIAL_BAR_H / 2, 1, SPECIAL_BAR_H, 0xffffff, 0.3)
      .setDepth(depth + 2);

    // --- Special effects for HUD bars ---
    // HUD Particle emitters
    this.spParticlesP1 = this.add.particles(0, 0, 'white_pixel', {
      speed: { min: 10, max: 20 },
      angle: { min: 260, max: 280 },
      scale: { start: 1, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 400,
      frequency: 100,
      tint: 0xffcc00,
      emitting: false
    }).setDepth(depth - 1);

    this.spParticlesP2 = this.add.particles(0, 0, 'white_pixel', {
      speed: { min: 10, max: 20 },
      angle: { min: 260, max: 280 },
      scale: { start: 1, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 400,
      frequency: 100,
      tint: 0xffcc00,
      emitting: false
    }).setDepth(depth - 1);

    // --- Player name labels ---
    const p1Color = this.p1Data.color.replace('0x', '#');
    const p2Color = this.p2Data.color.replace('0x', '#');

    this.add
      .text(BAR_P1_X, BAR_Y - 11, this.p1Data.name, {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: p1Color,
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setDepth(depth + 3);

    this.add
      .text(BAR_P2_X + BAR_W, BAR_Y - 11, this.p2Data.name, {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: p2Color,
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(depth + 3);

    // --- Timer display (center top) ---
    this.timerText = this.add
      .text(GAME_WIDTH / 2, BAR_Y + 2, '60', {
        fontSize: '18px',
        fontFamily: 'monospace',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(depth + 3);

    // --- Round indicators (dots below timer) ---
    this.roundDotsP1 = [];
    this.roundDotsP2 = [];
    const dotY = BAR_Y + 24;
    const dotSpacing = 10;
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      const p1Dot = this.add
        .circle(GAME_WIDTH / 2 - 20 - i * dotSpacing, dotY, 3, 0x333333)
        .setDepth(depth + 3)
        .setStrokeStyle(1, 0x666666);
      this.roundDotsP1.push(p1Dot);

      const p2Dot = this.add
        .circle(GAME_WIDTH / 2 + 20 + i * dotSpacing, dotY, 3, 0x333333)
        .setDepth(depth + 3)
        .setStrokeStyle(1, 0x666666);
      this.roundDotsP2.push(p2Dot);
    }

    // --- Stamina bars ---
    // P1 stamina
    this.staBgP1 = this.add
      .rectangle(STAMINA_P1_X, STAMINA_BAR_Y, STAMINA_BAR_W, STAMINA_BAR_H, 0x222222)
      .setOrigin(0, 0)
      .setDepth(depth);
    this.staBarP1 = this.add
      .rectangle(STAMINA_P1_X, STAMINA_BAR_Y, STAMINA_BAR_W, STAMINA_BAR_H, 0x00cccc)
      .setOrigin(0, 0)
      .setDepth(depth + 1);
    this.add
      .rectangle(
        STAMINA_P1_X + STAMINA_BAR_W / 2,
        STAMINA_BAR_Y + STAMINA_BAR_H / 2,
        STAMINA_BAR_W + 2,
        STAMINA_BAR_H + 2,
      )
      .setStrokeStyle(1, 0x444444)
      .setFillStyle()
      .setDepth(depth + 2);

    // P2 stamina
    this.staBgP2 = this.add
      .rectangle(STAMINA_P2_X, STAMINA_BAR_Y, STAMINA_BAR_W, STAMINA_BAR_H, 0x222222)
      .setOrigin(0, 0)
      .setDepth(depth);
    this.staBarP2 = this.add
      .rectangle(
        STAMINA_P2_X + STAMINA_BAR_W,
        STAMINA_BAR_Y,
        STAMINA_BAR_W,
        STAMINA_BAR_H,
        0x00cccc,
      )
      .setOrigin(1, 0)
      .setDepth(depth + 1);
    this.add
      .rectangle(
        STAMINA_P2_X + STAMINA_BAR_W / 2,
        STAMINA_BAR_Y + STAMINA_BAR_H / 2,
        STAMINA_BAR_W + 2,
        STAMINA_BAR_H + 2,
      )
      .setStrokeStyle(1, 0x444444)
      .setFillStyle()
      .setDepth(depth + 2);

    // --- Bar labels ---
    const labelStyle = {
      fontSize: '5px',
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 1,
    };

    // ESP labels (special)
    this.add
      .text(SPECIAL_P1_X + SPECIAL_BAR_W + 3, SPECIAL_BAR_Y, 'ESP', {
        ...labelStyle,
        color: '#ffcc00',
      })
      .setOrigin(0, 0)
      .setDepth(depth + 3);
    this.add
      .text(SPECIAL_P2_X - 3, SPECIAL_BAR_Y, 'ESP', { ...labelStyle, color: '#ffcc00' })
      .setOrigin(1, 0)
      .setDepth(depth + 3);

    // STA labels (stamina)
    this.add
      .text(STAMINA_P1_X + STAMINA_BAR_W + 3, STAMINA_BAR_Y, 'STA', {
        ...labelStyle,
        color: '#00cccc',
      })
      .setOrigin(0, 0)
      .setDepth(depth + 3);
    this.add
      .text(STAMINA_P2_X - 3, STAMINA_BAR_Y, 'STA', { ...labelStyle, color: '#00cccc' })
      .setOrigin(1, 0)
      .setDepth(depth + 3);

    // --- Pause button (below timer, local mode only) ---
    if (this.gameMode !== 'online') {
      this.pauseBtn = this.add
        .text(GAME_WIDTH / 2, BAR_Y + 34, '||', {
          fontSize: '10px',
          fontFamily: 'monospace',
          color: '#888888',
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 0)
        .setDepth(depth + 3)
        .setInteractive({ useHandCursor: true });
      this.pauseBtn.on('pointerdown', () => this._togglePause());
    }

    // --- Ping + room code (online/spectator, bottom center) ---
    if ((this.gameMode === 'online' || this.gameMode === 'spectator') && this.networkManager) {
      const infoY = GAME_HEIGHT - 8;
      this._roomCodeText = this.add
        .text(GAME_WIDTH / 2, infoY, `SALA: ${this.networkManager.roomId}`, {
          fontSize: '7px',
          fontFamily: 'monospace',
          color: '#aaaacc',
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(depth + 3);

      if (this.gameMode === 'online') {
        this._pingText = this.add
          .text(GAME_WIDTH / 2, infoY - 10, '', {
            fontSize: '7px',
            fontFamily: 'monospace',
            color: '#44ff44',
            stroke: '#000000',
            strokeThickness: 2,
          })
          .setOrigin(0.5, 1)
          .setDepth(depth + 3);
        this._pingUpdateCounter = 0;

        // Transport indicator (bottom-left corner)
        this._transportText = this.add
          .text(4, infoY, 'WS', {
            fontSize: '6px',
            fontFamily: 'monospace',
            color: '#666666',
            stroke: '#000000',
            strokeThickness: 2,
          })
          .setOrigin(0, 1)
          .setDepth(depth + 3);
      }
    }

    // --- Center text (for announcements) ---
    this.centerText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '', {
        fontSize: '28px',
        fontFamily: 'monospace',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(30);

    this.subtitleText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 5, '', {
        fontSize: '14px',
        fontFamily: 'monospace',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);
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
    const spRatioP1 = Phaser.Math.Clamp(this.p1Fighter.special / MAX_SPECIAL_FP, 0, 1);
    const spRatioP2 = Phaser.Math.Clamp(this.p2Fighter.special / MAX_SPECIAL_FP, 0, 1);
    this.spBarP1.width = SPECIAL_BAR_W * spRatioP1;
    this.spBarP2.width = SPECIAL_BAR_W * spRatioP2;

    // Flash special bar when it's at least 50% (enough for a special)
    const flashTimer = Math.floor(Date.now() / 150) % 2 === 0;
    
    // Effects for P1
    if (spRatioP1 >= 0.5) {
      if (spRatioP1 >= 1.0) {
        this.spBarP1.setFillStyle(flashTimer ? 0xffff00 : 0xffcc00);
      } else {
        // Subtle pulse for 50%
        this.spBarP1.setFillStyle(flashTimer ? 0xffdd00 : 0xffaa00);
      }
      
      // HUD effects
      this.spParticlesP1.emitting = true;
      this.spParticlesP1.setPosition(SPECIAL_P1_X + (SPECIAL_BAR_W * spRatioP1) / 2, SPECIAL_BAR_Y + SPECIAL_BAR_H / 2);
    } else {
      this.spBarP1.setFillStyle(0xffcc00);
      this.spParticlesP1.emitting = false;
    }

    // Effects for P2
    if (spRatioP2 >= 0.5) {
      if (spRatioP2 >= 1.0) {
        this.spBarP2.setFillStyle(flashTimer ? 0xffff00 : 0xffcc00);
      } else {
        // Subtle pulse for 50%
        this.spBarP2.setFillStyle(flashTimer ? 0xffdd00 : 0xffaa00);
      }

      // HUD effects
      this.spParticlesP2.emitting = true;
      this.spParticlesP2.setPosition(SPECIAL_P2_X + SPECIAL_BAR_W - (SPECIAL_BAR_W * spRatioP2) / 2, SPECIAL_BAR_Y + SPECIAL_BAR_H / 2);
    } else {
      this.spBarP2.setFillStyle(0xffcc00);
      this.spParticlesP2.emitting = false;
    }

    // Stamina bars
    const staRatioP1 = Phaser.Math.Clamp(this.p1Fighter.stamina / MAX_STAMINA_FP, 0, 1);
    const staRatioP2 = Phaser.Math.Clamp(this.p2Fighter.stamina / MAX_STAMINA_FP, 0, 1);
    this.staBarP1.width = STAMINA_BAR_W * staRatioP1;
    this.staBarP2.width = STAMINA_BAR_W * staRatioP2;

    // Flash red when depleted
    this.staBarP1.setFillStyle(staRatioP1 < 0.15 ? 0xff4444 : 0x00cccc);
    this.staBarP2.setFillStyle(staRatioP2 < 0.15 ? 0xff4444 : 0x00cccc);

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

    // Ping + transport indicator (update ~1x per second)
    if (this._pingText && this.networkManager) {
      this._pingUpdateCounter = (this._pingUpdateCounter || 0) + 1;
      if (this._pingUpdateCounter >= 60) {
        this._pingUpdateCounter = 0;
        const ms = this.networkManager.latency;
        this._pingText.setText(`${ms}ms`);
        if (ms > 150) this._pingText.setColor('#ff4444');
        else if (ms > 80) this._pingText.setColor('#ffcc00');
        else this._pingText.setColor('#44ff44');

        if (this._transportText) {
          if (this.networkManager._webrtcReady) {
            this._transportText.setText('P2P');
            this._transportText.setColor('#44ff44');
          } else {
            this._transportText.setText('WS');
            this._transportText.setColor('#666666');
          }
        }
      }
    }
  }

  // =========================================================================
  // P1 INPUT
  // =========================================================================
  // =========================================================================
  // ONLINE MODE
  // =========================================================================
  _setupOnlineMode() {
    const nm = this.networkManager;
    const slot = nm.getPlayerSlot();
    log.info('Online mode setup', {
      slot,
      room: nm.roomId,
      p1: this.p1Id,
      p2: this.p2Id,
      stage: this.stageId,
    });

    // Both peers are equal in rollback netcode (no host/guest distinction for gameplay)
    this.isHost = slot === 0;

    // Suppress direct round event firing inside simulation for both P1 and P2.
    // P1 handles round events from advance() return value.
    // P2 waits for P1's network message.
    this.combat.suppressRoundEvents = true;

    // Determine which fighter is local vs remote
    this.localFighter = slot === 0 ? this.p1Fighter : this.p2Fighter;
    this.remoteFighter = slot === 0 ? this.p2Fighter : this.p1Fighter;

    // Create RollbackManager — scale rollback window with overclock speed so the
    // system has room to absorb the increased frame production rate.
    const speed = this.game.autoplay?.speed || 1;
    this.rollbackManager = new RollbackManager(nm, slot, {
      inputDelay: ONLINE_INPUT_DELAY_FRAMES * speed,
      maxRollbackFrames: 7 * speed,
    });
    // Disable adaptive delay when overclocked — it would clamp values back down
    if (speed > 1) {
      this.rollbackManager._adaptiveDelayEnabled = false;
    }

    // Autoplay: use AI controller for local input instead of InputManager
    if (this.game.autoplay?.enabled) {
      const difficulty = this.game.autoplay.aiDifficulty || 'medium';
      const seed = this.game.autoplay.seed;
      this.autoplayAI = new AIController(this, this.localFighter, this.remoteFighter, difficulty);
      if (seed != null) {
        this.autoplayAI.setSeed(seed + slot);
      }
    }

    // Fight recorder for E2E testing and debug mode
    if (this.game.autoplay?.enabled || this.game.debugMode) {
      this.recorder = new FightRecorder({
        roomId: nm.roomId,
        playerSlot: slot,
        fighterId: slot === 0 ? this.p1Id : this.p2Id,
        opponentId: slot === 0 ? this.p2Id : this.p1Id,
        stageId: this.stageId,
        config: {
          seed: this.game.autoplay?.seed,
          speed: this.game.autoplay?.speed,
          aiDifficulty: this.game.autoplay?.aiDifficulty,
        },
      });
    }

    // Always-on telemetry
    this.telemetry = new MatchTelemetry(nm.roomId);
    this.telemetry.wireConnectionMonitor(nm.monitor);

    // Wire recorder hooks into rollback manager
    if (this.recorder) {
      this.rollbackManager._onRollback = (frame, depth) =>
        this.recorder.recordRollback(frame, depth);
      this.rollbackManager._onLocalChecksum = (frame, hash) =>
        this.recorder.recordChecksum(frame, hash);
      this.rollbackManager._onConfirmedInputs = (frame, p1, p2) =>
        this.recorder.recordConfirmedInputs(frame, p1, p2);
    }

    // Wire telemetry to rollback manager (augment existing callbacks)
    const origRollback = this.rollbackManager._onRollback;
    this.rollbackManager._onRollback = (frame, depth) => {
      this.telemetry.recordRollback(frame, depth);
      if (origRollback) origRollback(frame, depth);
    };

    // Wire transport changes to telemetry
    nm.onTransportDegraded(() => this.telemetry.recordTransportChange('websocket'));
    nm.onTransportRestored(() => this.telemetry.recordTransportChange('webrtc'));

    // Debug overlay (only in debug mode)
    if (this.game.debugMode) {
      import('../systems/DebugOverlay.js').then(({ DebugOverlay }) => {
        this.debugOverlay = new DebugOverlay(this, {
          getTelemetry: () => this.telemetry,
          getConnectionMonitor: () => nm.monitor,
          getTransportManager: () => nm.transport,
          getInputSync: () => nm.inputSync,
          getMatchState: () => this.matchState,
          onExportDebug: () => this._exportDebugBundle(),
          onExportAll: () => this._exportAllBundles(),
        });
      });
    }

    // Auto-respond to debug_request from peer (always wired, even without debug mode)
    nm.onDebugRequest(() => {
      import('../systems/DebugBundleExporter.js').then(({ DebugBundleExporter }) => {
        const bundle = DebugBundleExporter.generateBundle({
          recorder: this.recorder,
          telemetry: this.telemetry,
          matchState: this.matchState,
          sessionId: nm.sessionId,
          debugMode: !!this.game.debugMode,
        });
        nm.sendDebugResponse(bundle);
      });
    });

    // Wire desync detection + resync
    nm.onChecksum((frame, hash) => this.rollbackManager.handleRemoteChecksum(frame, hash));
    this.rollbackManager._onDesync = (frame, localHash, remoteHash) => {
      log.warn('Desync detected', { frame, local: localHash, remote: remoteHash });
      this.telemetry.recordDesync();
      this.recorder?.recordDesync(frame, localHash, remoteHash);
      this._showDesyncWarning();

      if (this.isHost) {
        // P1 proactively sends authoritative state
        const snapshot = this.rollbackManager.captureResyncSnapshot(
          this.p1Fighter,
          this.p2Fighter,
          this.combat,
        );
        nm.sendResync(snapshot);
      } else if (this.rollbackManager.shouldRequestResync()) {
        // P2 requests resync from P1
        this.rollbackManager._resyncPending = true;
        nm.sendResyncRequest(frame);
      }
    };

    // P1 responds to resync requests from P2
    nm.onResyncRequest(() => {
      if (!this.isHost) return;
      const snapshot = this.rollbackManager.captureResyncSnapshot(
        this.p1Fighter,
        this.p2Fighter,
        this.combat,
      );
      nm.sendResync(snapshot);
    });

    // P2 applies resync snapshots from P1
    nm.onResync((msg) => {
      if (this.isHost) return;
      log.warn('Resync applied', { frame: msg.snapshot.frame });
      this.telemetry.recordResync();
      this.rollbackManager.applyResync(msg.snapshot, this.p1Fighter, this.p2Fighter, this.combat);
      if (this._desyncWarning) {
        this._desyncWarning.destroy();
        this._desyncWarning = null;
      }
    });

    // Sync counter for spectator snapshots: P1 sends state every N frames
    this._syncInterval = 3;

    // Dedup guards for guest receiving round events
    this._lastProcessedRound = 0;
    this._matchOverProcessed = false;

    // P2 (guest) receives round events from P1 via network.
    // P1 detects round events locally from advance() return value;
    // P2 suppresses local detection and waits for P1's authoritative message.
    nm.onRoundEvent((msg) => {
      if (this.isHost) return; // P1 already handled locally
      if (msg.matchOver && this._matchOverProcessed) {
        log.debug('P2 onRoundEvent ignored: matchOver already processed');
        return;
      }
      if (!msg.matchOver && msg.roundNumber <= this._lastProcessedRound) {
        log.debug('P2 onRoundEvent ignored: round already processed', {
          round: msg.roundNumber,
          last: this._lastProcessedRound,
        });
        return;
      }

      log.debug('P2 onRoundEvent', {
        event: msg.event,
        winner: msg.winnerIndex,
        matchOver: msg.matchOver,
        round: msg.roundNumber,
        state: this.matchState.state,
      });

      // Don't modify combat state here — simulateFrame handles it deterministically.
      // Fire round-end audio/VFX via bridges, then UI transitions.
      if (msg.event === 'ko' || msg.event === 'timeup') {
        const syntheticEvents = [
          {
            type: msg.event === 'ko' ? 'round_ko' : 'round_timeup',
            winnerIndex: msg.winnerIndex,
            matchOver: msg.matchOver,
          },
        ];
        this.audioBridge.processEvents(syntheticEvents);
        this.vfxBridge.processEvents(syntheticEvents);
        if (msg.matchOver) {
          this._matchOverProcessed = true;
          this.onMatchOver(msg.winnerIndex);
        } else {
          this._lastProcessedRound = msg.roundNumber;
          this.onRoundOver(msg.winnerIndex);
        }
      }
    });

    // --- Graceful reconnection ---
    this.reconnectionManager = new ReconnectionManager({ gracePeriodMs: 20000 });

    this.reconnectionManager.onPause(() => {
      if (this.matchState.canTransition(MatchEvent.CONNECTION_LOST)) {
        this.matchState.transition(MatchEvent.CONNECTION_LOST);
      }
      this._showReconnectingOverlay();
      this.recorder?.recordNetworkEvent('reconnection_pause', {});
    });

    this.reconnectionManager.onResume(() => {
      if (this.matchState.canTransition(MatchEvent.OPPONENT_RECONNECTED)) {
        this.matchState.transition(MatchEvent.OPPONENT_RECONNECTED);
      }
      this._hideReconnectingOverlay();
      this.recorder?.recordNetworkEvent('reconnection_resume', {});
    });

    this.reconnectionManager.onDisconnect(() => {
      if (this.matchState.canTransition(MatchEvent.GRACE_EXPIRED)) {
        this.matchState.transition(MatchEvent.GRACE_EXPIRED);
      }
      this._hideReconnectingOverlay();
      this.recorder?.recordNetworkEvent('reconnection_disconnect', {});
      this.combat.roundActive = false;
      this.centerText.setText('DESCONECTADO');
      this.subtitleText.setText('Oponente abandono la pelea');
      this.localFighter.stop();
      this.remoteFighter.stop();
    });

    // Wire NetworkManager socket events → ReconnectionManager
    nm.onSocketClose(() => {
      this.reconnectionManager.handleConnectionLost();
      this.recorder?.recordNetworkEvent('socket_close', {});
    });
    nm.onSocketOpen(() => {
      this.reconnectionManager.handleConnectionRestored();
      nm.queueWebRTCInit(); // queue until rejoin_ack confirms signaling stable
      nm.sendRejoin(nm.getPlayerSlot());
      this.recorder?.recordNetworkEvent('socket_open', {});
    });
    nm.onOpponentReconnecting(() => this.reconnectionManager.handleOpponentReconnecting());
    nm.onOpponentReconnected(() => this.reconnectionManager.handleOpponentReconnected());
    nm.onDisconnect(() => this.reconnectionManager.handleOpponentDisconnected());

    // Transport degradation: DataChannel dropped but WebSocket still works
    nm.onTransportDegraded(() => {
      if (this._transportText) {
        this._transportText.setText('WS');
        this._transportText.setColor('#ffcc00');
      }
      this.recorder?.recordNetworkEvent('transport_degraded', {});
    });

    // Grace expired during fight — return to fighter select
    nm.onReturnToSelect(() => {
      this._hideReconnectingOverlay();
      this.combat.roundActive = false;
      this.centerText.setText('DESCONECTADO');
      this.subtitleText.setText('Oponente abandono la pelea');
      this.localFighter.stop();
      this.remoteFighter.stop();
      this.time.delayedCall(2000, () => {
        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('SelectScene', {
            gameMode: 'online',
            networkManager: this.networkManager,
          });
        });
      });
    });

    // Both peers detect KO/timeup independently (deterministic simulation guarantees agreement).
    // P1 still sends round events for spectators only.

    // All online players: register shout display + potion visuals + spectator count
    nm.onShout((text) => this._displayShout(text));
    nm.onPotionApplied((target, potionType) => this._showPotionEffect(target, potionType));
    nm.onSpectatorCount((count) => this._updateSpectatorCount(count));

    // P1 handles potion requests from spectators (still needs one authority for potions)
    if (this.isHost) {
      nm.onPotion((target, potionType) => {
        if (!this.combat.roundActive) return;
        const fighter = target === 0 ? this.p1Fighter : this.p2Fighter;
        if (potionType === 'hp') {
          fighter.hp = Math.min(MAX_HP, fighter.hp + 10);
        } else {
          fighter.special = Math.min(MAX_SPECIAL_FP, fighter.special + 15 * FP_SCALE);
        }
      });
    }
  }

  _handleLocalUpdate(time, delta) {
    // Replay mode: use recorded inputs via simulateFrame
    if (this._replayP1 && this._replayP2) {
      // Handle frame-based round transition cooldown
      if (this._replayRoundCooldown > 0) {
        this._replayRoundCooldown--;
        this._replayFrame++;
        if (this._replayRoundCooldown === 0) {
          console.log(
            `[REPLAY] Round transition complete at frame ${this._replayFrame}, starting round ${this.combat.roundNumber}`,
          );
          // Reset fighters and start next round
          this.p1Fighter.reset(GAME_WIDTH * 0.3);
          this.p2Fighter.reset(GAME_WIDTH * 0.7);
          this._updateHUD();
          // Start round without the time-based timer (replay uses frame-based tickTimer inside simulateFrame)
          this.combat.timer = 60;
          this.combat._timerAccumulator = 0;
          this.combat.roundActive = true;
          const nextState = this.matchState.transition(MatchEvent.TRANSITION_COMPLETE);
          if (nextState === MatchState.ROUND_INTRO) {
            this.matchState.transition(MatchEvent.INTRO_COMPLETE);
          }
          this.centerText.setText('');
          this.subtitleText.setText('');
        }
        return;
      }

      const frame = this._replayFrame;
      const totalFrames = Math.max(this._replayP1.totalFrames, this._replayP2.totalFrames);
      if (frame > totalFrames || this.combat.matchOver) {
        if (!this._replayFinished) {
          this._replayFinished = true;
          if (window.__FIGHT_LOG) window.__FIGHT_LOG.matchComplete = true;
          if (!this.combat.matchOver) {
            // Replay ran out of frames without a match-ending event.
            // This can happen because replay runs inputs linearly while the
            // original used rollback netcode which may produce different outcomes.
            console.log(`[REPLAY] Frames exhausted at ${frame} without match end. Forcing finish.`);
            console.log(
              `[REPLAY] Final state: p1hp=${this.p1Fighter.hp}, p2hp=${this.p2Fighter.hp}, score=${this.combat.p1RoundsWon}-${this.combat.p2RoundsWon}`,
            );
            // Determine winner from HP or round score
            const bundle = window.__REPLAY_BUNDLE;
            const winnerId =
              bundle?.p1?.finalState?.combat?.p1RoundsWon >= ROUNDS_TO_WIN
                ? this.p1Data.id
                : this.p2Data.id;
            const loserId = winnerId === this.p1Data.id ? this.p2Data.id : this.p1Data.id;
            this.combat.matchOver = true;
            // Transition to victory using the bundle's recorded winner
            this.time.delayedCall(1000, () => {
              this.cameras.main.fadeOut(500, 0, 0, 0);
              this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('VictoryScene', {
                  winnerId,
                  loserId,
                  p1Id: this.p1Id,
                  p2Id: this.p2Id,
                  stageId: this.stageId,
                  gameMode: this.gameMode,
                  networkManager: this.networkManager,
                  matchContext: this.matchContext,
                });
              });
            });
          } else {
            console.log(`[REPLAY] Finished at frame ${frame}, matchOver=true`);
          }
        }
        return;
      }
      const p1Input = this._replayP1.getEncoded(frame);
      const p2Input = this._replayP2.getEncoded(frame);
      const roundEvent = simFrame(this.p1Fighter, this.p2Fighter, this.combat, p1Input, p2Input);
      if (roundEvent) {
        console.log(
          `[REPLAY] Round event at frame ${frame}: ${roundEvent.type}, winner=P${roundEvent.winnerIndex + 1}`,
        );
        // Handle round end with frame-based transition (not time-based)
        this.combat.stopRound();
        if (roundEvent.winnerIndex === 0) this.combat.p1RoundsWon++;
        else this.combat.p2RoundsWon++;

        const winnerName = roundEvent.winnerIndex === 0 ? this.p1Data.name : this.p2Data.name;
        console.log(
          `[REPLAY] Score: P1=${this.combat.p1RoundsWon}, P2=${this.combat.p2RoundsWon} (need ${ROUNDS_TO_WIN})`,
        );

        if (this.combat.p1RoundsWon >= ROUNDS_TO_WIN || this.combat.p2RoundsWon >= ROUNDS_TO_WIN) {
          console.log(`[REPLAY] Match over!`);
          this.combat.matchOver = true;
          this.onMatchOver(roundEvent.winnerIndex);
        } else {
          // Show KO text and set frame-based cooldown for round transition
          this.centerText.setText('K.O.!');
          this.subtitleText.setText(`${winnerName} GANA EL ROUND!`);
          this.combat.roundNumber++;
          this._replayRoundCooldown = 180; // 3 seconds at 60fps
          this.p1Fighter.stop();
          this.p2Fighter.stop();
          console.log(`[REPLAY] Starting 180-frame cooldown for round ${this.combat.roundNumber}`);
        }
      }
      if (frame % 300 === 0) {
        console.log(
          `[REPLAY] frame=${frame}/${totalFrames}, timer=${this.combat.timer}, roundActive=${this.combat.roundActive}, p1hp=${this.p1Fighter.hp}, p2hp=${this.p2Fighter.hp}`,
        );
      }
      this._replayFrame++;
      return;
    }

    const wasRoundActive = this.combat.roundActive;

    // Build P1 input from keyboard/touch
    const input = this.inputManager;
    const p1Input = this.devConsole?.visible
      ? 0
      : encodeInput({
          left: input.left,
          right: input.right,
          up: input.up,
          down: input.down,
          lp: input.lightPunch,
          hp: input.heavyPunch,
          lk: input.lightKick,
          hk: input.heavyKick,
          sp: input.special,
        });
    input.consumeTouch();

    // Build P2 input from AI
    let p2Input = 0;
    if (this.aiController) {
      this.aiController.update(time, delta);
      const d = this.aiController.decision;
      p2Input = encodeInput({
        left: d.moveDir < 0,
        right: d.moveDir > 0,
        up: d.jump,
        down: d.block,
        lp: d.attack === 'lightPunch',
        hp: d.attack === 'heavyPunch',
        lk: d.attack === 'lightKick',
        hk: d.attack === 'heavyKick',
        sp: d.attack === 'special',
      });
      // Consume one-shot decisions so they don't repeat
      this.aiController.decision.jump = false;
      this.aiController.decision.attack = null;
    }

    // Run same tick() as online mode — deterministic simulation on sim objects
    const { events, roundEvent } = tick(
      this.p1Fighter.sim,
      this.p2Fighter.sim,
      this.combat.sim,
      p1Input,
      p2Input,
      this._localFrame++,
    );

    // Route sim events to presentation bridges
    if (events.length > 0) {
      this.audioBridge.processEvents(events);
      this.vfxBridge.processEvents(events);
    }

    // Handle round events (same flow as online P1/host)
    if (roundEvent) {
      log.debug('Local roundEvent', {
        type: roundEvent.type,
        winner: roundEvent.winnerIndex,
        matchOver: this.combat.matchOver,
        frame: this._localFrame,
        state: this.matchState.state,
      });
      this.combat.stopRound();
      if (this.combat.matchOver) {
        this.onMatchOver(roundEvent.winnerIndex);
      } else {
        this.onRoundOver(roundEvent.winnerIndex);
      }
    }

    // Detect simulation-driven round reset (transitionTimer expired → roundActive became true)
    if (!wasRoundActive && this.combat.roundActive) {
      if (this.matchState.canTransition(MatchEvent.TRANSITION_COMPLETE)) {
        const nextState = this.matchState.transition(MatchEvent.TRANSITION_COMPLETE);
        if (nextState === MatchState.ROUND_INTRO) {
          this.matchState.transition(MatchEvent.INTRO_COMPLETE);
        }
      }
      this.p1Fighter.syncSprite();
      this.p2Fighter.syncSprite();
      if (this.p1Fighter.hasAnims) this.p1Fighter.sprite.play(`${this.p1Fighter.fighterId}_idle`);
      if (this.p2Fighter.hasAnims) this.p2Fighter.sprite.play(`${this.p2Fighter.fighterId}_idle`);
      this._updateHUD();
      this.centerText.setText(`ROUND ${this.combat.roundNumber - 1}`);
      this.subtitleText.setText('');
      this.game.audioManager.play('announce_round');
      this.time.delayedCall(800, () => {
        this.centerText.setText('A PELEAR!');
        this.game.audioManager.play('announce_fight');
        this.time.delayedCall(500, () => {
          this.centerText.setText('');
          this.subtitleText.setText('');
        });
      });
    }
  }

  _showDesyncWarning() {
    if (this._desyncWarning) return;
    this._desyncWarning = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 28, 'DESYNC', {
        fontSize: '7px',
        fontFamily: 'monospace',
        color: '#ff4444',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(25);
  }

  _handleOnlineUpdate(time, delta) {
    this.frameCounter++;
    const wasRoundActive = this.combat.roundActive;

    // Read local input: from AI in autoplay mode, from InputManager otherwise
    let localInput;
    if (this.autoplayAI) {
      this.autoplayAI.update(time, delta);
      const d = this.autoplayAI.decision;
      localInput = {
        left: d.moveDir < 0,
        right: d.moveDir > 0,
        up: d.jump,
        down: d.block,
        lp: d.attack === 'lightPunch',
        hp: d.attack === 'heavyPunch',
        lk: d.attack === 'lightKick',
        hk: d.attack === 'heavyKick',
        sp: d.attack === 'special',
      };
      // Consume one-shot decisions so they don't repeat
      this.autoplayAI.decision.jump = false;
      this.autoplayAI.decision.attack = null;
    } else {
      const input = this.inputManager;
      localInput = {
        left: input.left,
        right: input.right,
        up: input.up,
        down: input.down,
        lp: input.lightPunch,
        hp: input.heavyPunch,
        lk: input.lightKick,
        hk: input.heavyKick,
        sp: input.special,
      };
      input.consumeTouch();
    }

    // Record input for E2E testing
    this.recorder?.recordInput(this.rollbackManager.currentFrame, localInput);

    // Run rollback advance (handles input sending, prediction, rollback, simulation)
    const { roundEvent, events } = this.rollbackManager.advance(
      localInput,
      this.p1Fighter,
      this.p2Fighter,
      this.combat,
    );

    // Route sim events to presentation bridges
    if (events?.length > 0) {
      this.audioBridge.processEvents(events);
      this.vfxBridge.processEvents(events);
    }

    // Record round events for BOTH peers at the exact simulation frame
    if (roundEvent) {
      this.recorder?.recordRoundEvent(this.rollbackManager.currentFrame, roundEvent);
      if (roundEvent.matchOver) {
        this.recorder?.captureEndState(
          this.p1Fighter,
          this.p2Fighter,
          this.combat,
          this.rollbackManager.currentFrame,
        );
      }
    }

    // P1 (host) handles round events: stop round timer + UI transitions
    // Audio/VFX already handled by bridges above via round_ko/round_timeup events
    if (roundEvent && this.isHost) {
      log.debug('P1 roundEvent', {
        type: roundEvent.type,
        winner: roundEvent.winnerIndex,
        matchOver: this.combat.matchOver,
        frame: this.rollbackManager.currentFrame,
        state: this.matchState.state,
      });
      this.combat.stopRound();
      if (this.combat.matchOver) {
        this.onMatchOver(roundEvent.winnerIndex);
      } else {
        this.onRoundOver(roundEvent.winnerIndex);
      }
    }

    // Detect simulation-driven round reset (transitionTimer expired → roundActive became true)
    if (!wasRoundActive && this.combat.roundActive) {
      if (this.matchState.canTransition(MatchEvent.TRANSITION_COMPLETE)) {
        const nextState = this.matchState.transition(MatchEvent.TRANSITION_COMPLETE);
        if (nextState === MatchState.ROUND_INTRO) {
          this.matchState.transition(MatchEvent.INTRO_COMPLETE);
        }
      }
      // Sync sprites to new positions after reset
      this.p1Fighter.syncSprite();
      this.p2Fighter.syncSprite();
      if (this.p1Fighter.hasAnims) this.p1Fighter.sprite.play(`${this.p1Fighter.fighterId}_idle`);
      if (this.p2Fighter.hasAnims) this.p2Fighter.sprite.play(`${this.p2Fighter.fighterId}_idle`);
      this._updateHUD();
      // Show round intro text (visual only)
      this.centerText.setText(`ROUND ${this.combat.roundNumber - 1}`);
      this.subtitleText.setText('');
      this.game.audioManager.play('announce_round');
      this.time.delayedCall(800, () => {
        this.centerText.setText('A PELEAR!');
        this.game.audioManager.play('announce_fight');
        this.time.delayedCall(500, () => {
          this.centerText.setText('');
          this.subtitleText.setText('');
        });
      });
    }

    // P1 sends periodic state snapshots for spectators
    if (this.isHost && this.frameCounter % this._syncInterval === 0) {
      this.networkManager.sendSync({
        p1hp: this.p1Fighter.hp,
        p1sp: this.p1Fighter.special,
        p1sta: this.p1Fighter.stamina,
        p2hp: this.p2Fighter.hp,
        p2sp: this.p2Fighter.special,
        p2sta: this.p2Fighter.stamina,
        timer: this.combat.timer,
        p1x: this.p1Fighter.simX / FP_SCALE,
        p2x: this.p2Fighter.simX / FP_SCALE,
      });
    }
  }

  /** Send round event to guest + spectators (3x with 200ms spacing for reliability) */
  _sendRoundEvent(event, winnerIndex) {
    if (this.gameMode === 'online' && this.isHost && this.networkManager) {
      const payload = {
        event,
        winnerIndex,
        p1Rounds: this.combat.p1RoundsWon,
        p2Rounds: this.combat.p2RoundsWon,
        roundNumber: this.combat.roundNumber,
        matchOver: this.combat.matchOver,
      };
      this.networkManager.sendRoundEvent(payload);
      setTimeout(() => this.networkManager?.sendRoundEvent(payload), 200);
      setTimeout(() => this.networkManager?.sendRoundEvent(payload), 400);
    }
  }

  _applyInputToFighter(fighter, inputState) {
    const speed = (80 + fighter.data.stats.speed * 20) * FP_SCALE;

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
  // SPECTATOR MODE
  // =========================================================================
  _setupSpectatorMode() {
    const nm = this.networkManager;

    // Receive authoritative state syncs from host
    nm.onSync((msg) => {
      this.p1Fighter.hp = msg.p1hp;
      this.p1Fighter.special = msg.p1sp;
      this.p2Fighter.hp = msg.p2hp;
      this.p2Fighter.special = msg.p2sp;
      this.combat.timer = msg.timer;
      // Lerp positions for smooth movement, teleport for large diffs
      const sp1dx = Math.abs(this.p1Fighter.sprite.x - msg.p1x);
      this.p1Fighter.sprite.x =
        sp1dx > 50 ? msg.p1x : this.p1Fighter.sprite.x + (msg.p1x - this.p1Fighter.sprite.x) * 0.3;
      const sp2dx = Math.abs(this.p2Fighter.sprite.x - msg.p2x);
      this.p2Fighter.sprite.x =
        sp2dx > 50 ? msg.p2x : this.p2Fighter.sprite.x + (msg.p2x - this.p2Fighter.sprite.x) * 0.3;
    });

    nm.onRoundEvent((msg) => {
      this.combat.stopRound();
      this.combat.p1RoundsWon = msg.p1Rounds;
      this.combat.p2RoundsWon = msg.p2Rounds;
      this.combat.roundNumber = msg.roundNumber;

      if (msg.event === 'ko' || msg.event === 'timeup') {
        // Route round-end audio/VFX through bridges
        const syntheticEvents = [
          {
            type: msg.event === 'ko' ? 'round_ko' : 'round_timeup',
            winnerIndex: msg.winnerIndex,
            matchOver: msg.matchOver,
          },
        ];
        this.audioBridge.processEvents(syntheticEvents);
        this.vfxBridge.processEvents(syntheticEvents);

        if (msg.matchOver) {
          this.combat.matchOver = true;
          this.onMatchOver(msg.winnerIndex);
        } else {
          this.onRoundOver(msg.winnerIndex);
        }
      }
    });

    nm.onShout((text) => this._displayShout(text));
    nm.onPotionApplied((target, potionType) => this._showPotionEffect(target, potionType));
    nm.onSpectatorCount((count) => this._updateSpectatorCount(count));

    nm.onDisconnect(() => {
      this.combat.roundActive = false;
      this.centerText.setText('DESCONECTADO');
      this.subtitleText.setText('Un jugador abandono la pelea');
      this.p1Fighter.stop();
      this.p2Fighter.stop();
    });

    // Spectator badge
    this.add
      .text(GAME_WIDTH - 8, 40, 'ESPECTADOR', {
        fontSize: '7px',
        fontFamily: 'Arial',
        color: '#88ccff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(25);

    // Spectator count display
    this._spectatorCountText = this.add
      .text(GAME_WIDTH - 8, 49, '', {
        fontSize: '7px',
        fontFamily: 'Arial',
        color: '#aaaacc',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(25);

    // Build spectator UI overlay
    this._createSpectatorOverlay();
  }

  _handleSpectatorUpdate() {
    const nm = this.networkManager;

    // Apply inputs from both players for animations
    const p1Input = nm.getRemoteInputForSlot(0);
    this._applyInputToFighter(this.p1Fighter, p1Input);

    const p2Input = nm.getRemoteInputForSlot(1);
    this._applyInputToFighter(this.p2Fighter, p2Input);

    // Body collision + facing
    this.combat.resolveBodyCollision(this.p1Fighter, this.p2Fighter);
    this.p1Fighter.faceOpponent(this.p2Fighter);
    this.p2Fighter.faceOpponent(this.p1Fighter);
  }

  _createSpectatorOverlay() {
    const barY = GAME_HEIGHT - 25;
    // Semi-transparent dark bar
    this.add
      .rectangle(GAME_WIDTH / 2, barY + 12, GAME_WIDTH, 25, 0x000000)
      .setAlpha(0.6)
      .setDepth(25);

    const shouts = ['DALE!', 'NOOO!', 'VAMOS!', 'OLE!'];
    const shoutCooldowns = {};
    const btnW = 48;
    const shoutStartX = 30;

    shouts.forEach((text, i) => {
      const x = shoutStartX + i * (btnW + 4);
      shoutCooldowns[text] = 0;
      this._createSpectatorButton(x, barY + 12, btnW, 18, text, 0x224488, () => {
        const now = Date.now();
        if (now - shoutCooldowns[text] < 2000) return;
        shoutCooldowns[text] = now;
        this.networkManager.sendShout(text);
      });
    });

    // Potion buttons
    const potions = [
      { label: 'vida J1', target: 0, potionType: 'hp' },
      { label: 'esp J1', target: 0, potionType: 'special' },
      { label: 'vida J2', target: 1, potionType: 'hp' },
      { label: 'esp J2', target: 1, potionType: 'special' },
    ];
    const potionStartX = GAME_WIDTH - 30 - (potions.length - 1) * (btnW + 4);
    this._potionButtons = [];
    let potionCooldown = 0;

    potions.forEach((p, i) => {
      const x = potionStartX + i * (btnW + 4);
      const btn = this._createSpectatorButton(x, barY + 12, btnW, 18, p.label, 0x446622, () => {
        const now = Date.now();
        if (now - potionCooldown < 15000) return;
        potionCooldown = now;
        this.networkManager.sendPotion(p.target, p.potionType);
        // Gray out all potion buttons during cooldown
        this._potionButtons.forEach((b) => {
          b.bg.setFillStyle(0x333333);
        });
        this.time.delayedCall(15000, () => {
          this._potionButtons.forEach((b) => {
            b.bg.setFillStyle(0x446622);
          });
        });
      });
      this._potionButtons.push(btn);
    });
  }

  _createSpectatorButton(x, y, w, h, label, color, callback) {
    const bg = this.add
      .rectangle(x, y, w, h, color)
      .setStrokeStyle(1, 0x666688)
      .setInteractive({ useHandCursor: true })
      .setDepth(26);
    const text = this.add
      .text(x, y, label, {
        fontSize: '7px',
        fontFamily: 'Arial',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(27);

    bg.on('pointerover', () => text.setColor('#ffcc00'));
    bg.on('pointerout', () => text.setColor('#ffffff'));
    bg.on('pointerdown', callback);

    return { bg, text };
  }

  // =========================================================================
  // SHOUTS & POTIONS (all modes)
  // =========================================================================
  _displayShout(text) {
    // Max 3 active shouts
    if (this._activeShouts.length >= 3) return;

    const x = Phaser.Math.Between(120, 360);
    const startY = 195;
    const shoutText = this.add
      .text(x, startY, text, {
        fontSize: '12px',
        fontFamily: 'Arial Black, Arial',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(25);

    this._activeShouts.push(shoutText);

    this.tweens.add({
      targets: shoutText,
      y: startY - 30,
      alpha: 0,
      duration: 2000,
      ease: 'Power1',
      onComplete: () => {
        const idx = this._activeShouts.indexOf(shoutText);
        if (idx !== -1) this._activeShouts.splice(idx, 1);
        shoutText.destroy();
      },
    });
  }

  _showPotionEffect(target, potionType) {
    const fighter = target === 0 ? this.p1Fighter : this.p2Fighter;
    const tintColor = potionType === 'hp' ? 0x00ff66 : 0xffff00;
    const label = potionType === 'hp' ? '+10 HP' : '+15 ESP';

    // Tint flash
    fighter.sprite.setTint(tintColor);
    this.time.delayedCall(300, () => fighter.sprite.clearTint());

    // Floating text
    const floatText = this.add
      .text(fighter.sprite.x, fighter.sprite.y - 40, label, {
        fontSize: '10px',
        fontFamily: 'Arial',
        color: potionType === 'hp' ? '#00ff66' : '#ffff00',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(25);

    this.tweens.add({
      targets: floatText,
      y: floatText.y - 20,
      alpha: 0,
      duration: 1200,
      onComplete: () => floatText.destroy(),
    });
  }

  _updateSpectatorCount(count) {
    if (!this._spectatorCountText) {
      // Create spectator count text for online players too
      this._spectatorCountText = this.add
        .text(GAME_WIDTH - 8, 40, '', {
          fontSize: '7px',
          fontFamily: 'Arial',
          color: '#aaaacc',
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(1, 0)
        .setDepth(25);
    }
    if (count > 0) {
      this._spectatorCountText.setText(`${count} espectador${count !== 1 ? 'es' : ''}`);
    } else {
      this._spectatorCountText.setText('');
    }
  }

  // =========================================================================
  // PAUSE SYSTEM
  // =========================================================================
  _togglePause() {
    if (this.gameMode === 'online') {
      // Show brief "no pause online" message
      if (this._noPauseMsg) return;
      this._noPauseMsg = this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'NO PAUSA EN LINEA', {
          fontSize: '12px',
          fontFamily: 'monospace',
          color: '#ff4444',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(50);
      this.time.delayedCall(1200, () => {
        if (this._noPauseMsg) {
          this._noPauseMsg.destroy();
          this._noPauseMsg = null;
        }
      });
      return;
    }
    if (this.isPaused) this._resumeGame();
    else this._pauseGame();
  }

  _pauseGame() {
    if (this.matchState.canTransition(MatchEvent.PAUSE)) {
      this.matchState.transition(MatchEvent.PAUSE);
    }
    this.time.paused = true;
    this.tweens.pauseAll();

    // Dark overlay + text
    this._pauseOverlay = this.add.container(0, 0).setDepth(60);
    const bg = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x000000,
      0.6,
    );
    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, 'PAUSA', {
        fontSize: '28px',
        fontFamily: 'monospace',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    // CONTINUAR button
    const contBg = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 5, 110, 20, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });
    const contText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 5, 'CONTINUAR', {
        fontSize: '9px',
        fontFamily: 'Arial',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    contBg.on('pointerover', () => {
      contBg.setFillStyle(0x333366);
      contText.setColor('#ffcc00');
    });
    contBg.on('pointerout', () => {
      contBg.setFillStyle(0x222244);
      contText.setColor('#ffffff');
    });
    contBg.on('pointerdown', () => this._resumeGame());

    // SALIR button
    const salirBg = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, 110, 20, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });
    const salirText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, 'SALIR', {
        fontSize: '9px',
        fontFamily: 'Arial',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    salirBg.on('pointerover', () => {
      salirBg.setFillStyle(0x333366);
      salirText.setColor('#ffcc00');
    });
    salirBg.on('pointerout', () => {
      salirBg.setFillStyle(0x222244);
      salirText.setColor('#ffffff');
    });
    salirBg.on('pointerdown', () => {
      this._resumeGame();
      if (this.gameMode === 'online' && this.networkManager) {
        this.networkManager.destroy();
      }
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('TitleScene');
      });
    });

    this._pauseOverlay.add([bg, title, contBg, contText, salirBg, salirText]);
  }

  _resumeGame() {
    if (this.matchState.canTransition(MatchEvent.RESUME)) {
      this.matchState.transition(MatchEvent.RESUME);
    }
    this.time.paused = false;
    this.tweens.resumeAll();
    if (this._pauseOverlay) {
      this._pauseOverlay.destroy();
      this._pauseOverlay = null;
    }
  }

  // =========================================================================
  // RECONNECTION OVERLAY
  // =========================================================================
  _showReconnectingOverlay() {
    if (this._reconnectOverlay) return;
    this._reconnectOverlay = this.add.container(0, 0).setDepth(55);

    const bg = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x000000,
      0.5,
    );
    this._reconnectText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10, 'RECONECTANDO...', {
        fontSize: '18px',
        fontFamily: 'monospace',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this._reconnectCountdown = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 15, '5', {
        fontSize: '14px',
        fontFamily: 'monospace',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5);

    this._reconnectOverlay.add([bg, this._reconnectText, this._reconnectCountdown]);
  }

  _hideReconnectingOverlay() {
    if (this._reconnectOverlay) {
      this._reconnectOverlay.destroy();
      this._reconnectOverlay = null;
      this._reconnectText = null;
      this._reconnectCountdown = null;
    }
  }

  _updateReconnectingOverlay() {
    if (this._reconnectCountdown && this.reconnectionManager) {
      const remaining = Math.max(0, 20000 - this.reconnectionManager.elapsed());
      this._reconnectCountdown.setText(String(Math.ceil(remaining / 1000)));
    }
  }

  // =========================================================================
  // ROUND FLOW
  // =========================================================================
  /** Visual-only round intro for online mode — doesn't touch roundActive or startRound. */
  /**
   * Frame-0 synchronization (RFC 0002 §2B.3).
   * Both peers compute a hash of the initial game state and exchange it.
   * Simulation starts only after both hashes match.
   */
  _startFrameZeroSync() {
    const nm = this.networkManager;
    const localHash = this.rollbackManager.getFrame0SyncHash(
      this.p1Fighter,
      this.p2Fighter,
      this.combat,
    );

    this._syncLocalHash = localHash;
    this._syncRemoteHash = null;

    // Show sync status
    this.centerText.setText('SINCRONIZANDO...');
    this.subtitleText.setText('');

    // Listen for peer's hash
    nm.onFrameZeroSync((msg) => {
      log.debug('Frame-0 sync: received peer hash', { hash: msg.hash });
      this._syncRemoteHash = msg.hash;
      this._checkFrameZeroSync();
    });

    // Send our hash immediately and retry every 500ms until confirmed
    log.debug('Frame-0 sync: sending hash', { hash: localHash });
    nm.sendFrameZeroSync(localHash);
    this._syncRetryTimer = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        if (this.matchState.state === MatchState.SYNCHRONIZING) {
          nm.sendFrameZeroSync(localHash);
        }
      },
    });

    // Timeout: 5 seconds
    this._syncTimeout = this.time.delayedCall(5000, () => {
      if (this.matchState.state === MatchState.SYNCHRONIZING) {
        log.warn('Frame-0 sync timed out');
        this._cleanupSyncTimers();
        this.matchState.transition(MatchEvent.SYNC_TIMEOUT);
        this.centerText.setText('DESCONECTADO');
        this.subtitleText.setText('Sincronización fallida');
        this.combat.roundActive = false;
      }
    });
  }

  _cleanupSyncTimers() {
    if (this._syncTimeout) {
      this._syncTimeout.destroy();
      this._syncTimeout = null;
    }
    if (this._syncRetryTimer) {
      this._syncRetryTimer.destroy();
      this._syncRetryTimer = null;
    }
  }

  _checkFrameZeroSync() {
    if (this.matchState.state !== MatchState.SYNCHRONIZING) return;
    if (this._syncRemoteHash === null) return;

    this._cleanupSyncTimers();

    if (this._syncLocalHash === this._syncRemoteHash) {
      log.debug('Frame-0 sync confirmed', { hash: this._syncLocalHash });
    } else {
      log.warn('Frame-0 hash mismatch', {
        local: this._syncLocalHash,
        remote: this._syncRemoteHash,
      });
    }

    this.matchState.transition(MatchEvent.SYNC_CONFIRMED);
    this._showRoundIntroVisual();
    this.matchState.transition(MatchEvent.INTRO_COMPLETE);
  }

  _showRoundIntroVisual() {
    this.centerText.setText(`ROUND ${this.combat.roundNumber}`);
    this.subtitleText.setText('');
    this.game.audioManager.play('announce_round');
    this.centerText.setScale(2.5).setAlpha(0);
    this.tweens.add({
      targets: this.centerText,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 400,
      ease: 'Back.easeOut',
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
        ease: 'Back.easeOut',
      });
      this.time.delayedCall(800, () => {
        this.centerText.setText('');
        this.subtitleText.setText('');
      });
    });
  }

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
      ease: 'Back.easeOut',
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
        ease: 'Back.easeOut',
      });
      this.time.delayedCall(800, () => {
        this.centerText.setText('');
        this.subtitleText.setText('');
        this.combat.startRound();
        this.matchState.transition(MatchEvent.INTRO_COMPLETE);
      });
    });
  }

  /**
   * Called by CombatSystem when a round ends but match is not over.
   * @param {number} winnerIndex - 0 for P1, 1 for P2
   */
  onRoundOver(winnerIndex) {
    if (!this.matchState.canTransition(MatchEvent.ROUND_OVER)) {
      log.warn('onRoundOver ignored: invalid state', { state: this.matchState.state });
      return;
    }
    log.debug('Round over', {
      winner: winnerIndex,
      state: this.matchState.state,
      rounds: `${this.combat.p1RoundsWon}-${this.combat.p2RoundsWon}`,
    });
    this.matchState.transition(MatchEvent.ROUND_OVER);

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
      ease: 'Back.easeOut',
    });

    // Both online and local mode: simulation handles round reset via deterministic
    // transitionTimer inside tick(). Only show visual feedback here.
    this.time.delayedCall(1500, () => {
      this.centerText.setText(`${winnerName} GANA EL ROUND!`);
      this.centerText.setScale(1).setAlpha(1);
      this.subtitleText.setText(`RONDAS: ${this.combat.p1RoundsWon} - ${this.combat.p2RoundsWon}`);
    });
  }

  /**
   * Called by CombatSystem when the match is over (someone won enough rounds).
   * @param {number} winnerIndex - 0 for P1, 1 for P2
   */
  onMatchOver(winnerIndex) {
    if (!this.matchState.canTransition(MatchEvent.MATCH_OVER)) {
      // Already processed — can happen when duplicate round events arrive after reconnection
      if (this.matchState.canTransition(MatchEvent.ROUND_OVER)) {
        // Still in ROUND_ACTIVE — need ROUND_OVER first, then check again
      } else {
        log.warn('onMatchOver ignored: invalid state', { state: this.matchState.state });
        return;
      }
    }
    log.debug('Match over', {
      winner: winnerIndex,
      state: this.matchState.state,
      rounds: `${this.combat.p1RoundsWon}-${this.combat.p2RoundsWon}`,
    });
    if (this.matchState.canTransition(MatchEvent.ROUND_OVER)) {
      this.matchState.transition(MatchEvent.ROUND_OVER);
    }
    this.matchState.transition(MatchEvent.MATCH_OVER);

    // Host sends match-over event to guest
    this._sendRoundEvent('ko', winnerIndex);

    const winnerData = winnerIndex === 0 ? this.p1Data : this.p2Data;
    const loserData = winnerIndex === 0 ? this.p2Data : this.p1Data;

    // Stop AI
    if (this.aiController) {
      this.aiController.destroy();
      this.aiController = null;
    }

    // In online mode, don't modify simulation state — simulateFrame handles it
    if (this.gameMode !== 'online') {
      this.p1Fighter.stop();
      this.p2Fighter.stop();
    }

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
      ease: 'Back.easeOut',
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
          networkManager: this.networkManager,
          matchContext: this.matchContext,
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
    const colors = intensity === 'special' ? [0xffcc00, 0xff6600, 0xffffff] : [0xffffff, 0xffccaa];
    const spread = intensity === 'special' ? 40 : intensity === 'heavy' ? 30 : 20;

    for (let i = 0; i < count; i++) {
      const spark = this.add
        .rectangle(
          x,
          y,
          Phaser.Math.Between(2, 5),
          Phaser.Math.Between(2, 5),
          Phaser.Utils.Array.GetRandom(colors),
        )
        .setDepth(15);

      this.tweens.add({
        targets: spark,
        x: x + Phaser.Math.Between(-spread, spread),
        y: y + Phaser.Math.Between(-spread, spread * 0.3),
        alpha: 0,
        scaleX: 0,
        scaleY: 0,
        duration: Phaser.Math.Between(150, 300),
        onComplete: () => spark.destroy(),
      });
    }
  }

  /**
   * Flash a white overlay across the screen (used for KO moments).
   */
  flashScreen() {
    const flash = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xffffff)
      .setDepth(50)
      .setAlpha(0.6);

    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 300,
      onComplete: () => flash.destroy(),
    });
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================
  shutdown() {
    if (this.isPaused) this._resumeGame();
    if (this.combat) this.combat.stopRound();
    if (this.aiController) this.aiController.destroy();
    if (this.touchControls) this.touchControls.destroy();
    if (this.reconnectionManager) this.reconnectionManager.destroy();
    if (this.telemetry) this.telemetry.destroy();
    if (this.debugOverlay) this.debugOverlay.destroy();
    this._cleanupSyncTimers();
    this.matchState = null;
    // Destroy projectiles
    for (const proj of this.projectiles) {
      proj.destroy();
    }
    this.projectiles = [];
  }
}
