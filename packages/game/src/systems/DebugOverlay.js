import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';

/**
 * Debug overlay HUD showing network health stats.
 * Bottom-left, collapsed by default. Tap to expand.
 * Only visible when game.debugMode is true.
 */
export class DebugOverlay {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} options
   * @param {Function} options.getTelemetry - returns MatchTelemetry instance
   * @param {Function} options.getConnectionMonitor - returns ConnectionMonitor
   * @param {Function} options.getTransportManager - returns TransportManager
   * @param {Function} options.getInputSync - returns InputSync
   * @param {Function} options.getMatchState - returns MatchStateMachine
   * @param {Function} [options.onExportDebug] - called when "Exportar Debug" is tapped
   * @param {Function} [options.onExportAll] - called when "Exportar Todo" is tapped
   */
  constructor(scene, options) {
    this.scene = scene;
    this.options = options;
    this.expanded = false;

    const style = {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#00ff00',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
    };

    this.text = scene.add.text(2, GAME_HEIGHT - 14, '', style);
    this.text.setDepth(200);
    this.text.setScrollFactor(0);
    this.text.setInteractive();
    this.text.on('pointerdown', () => {
      this.expanded = !this.expanded;
      this._update();
    });

    // Export buttons (only visible when expanded)
    this.exportBtn = scene.add.text(2, GAME_HEIGHT - 26, '[Exportar Debug]', {
      ...style,
      fontSize: '7px',
    });
    this.exportBtn.setDepth(200);
    this.exportBtn.setScrollFactor(0);
    this.exportBtn.setVisible(false);
    this.exportBtn.setInteractive();
    this.exportBtn.on('pointerdown', () => {
      if (options.onExportDebug) options.onExportDebug();
    });

    this.exportAllBtn = scene.add.text(82, GAME_HEIGHT - 26, '[Todo]', {
      ...style,
      fontSize: '7px',
    });
    this.exportAllBtn.setDepth(200);
    this.exportAllBtn.setScrollFactor(0);
    this.exportAllBtn.setVisible(false);
    this.exportAllBtn.setInteractive();
    this.exportAllBtn.on('pointerdown', () => {
      if (options.onExportAll) options.onExportAll();
    });

    // Update once per second
    this._timer = scene.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => this._update(),
    });

    this._update();
  }

  _update() {
    const telemetry = this.options.getTelemetry?.();
    const monitor = this.options.getConnectionMonitor?.();
    const transport = this.options.getTransportManager?.();
    const inputSync = this.options.getInputSync?.();
    const matchState = this.options.getMatchState?.();

    const rtt = monitor?.rtt ?? 0;
    const mode = transport?._transportMode === 'webrtc' ? 'P2P' : 'WS';

    if (!this.expanded) {
      this.text.setText(`RTT: ${rtt}ms  ${mode}`);
      this.text.setY(GAME_HEIGHT - 14);
      this.exportBtn.setVisible(false);
      this.exportAllBtn.setVisible(false);
      return;
    }

    const rollbacks = telemetry?.rollbackCount ?? 0;
    const maxDepth = telemetry?.maxRollbackDepth ?? 0;
    const desyncs = telemetry?.desyncCount ?? 0;
    const bufDepth = inputSync ? Object.keys(inputSync.remoteInputBuffer).length : 0;
    const state = matchState?.state ?? '?';

    const lines = [
      `RTT: ${rtt}ms    ${mode}`,
      `Rollbacks: ${rollbacks}  Max: ${maxDepth}`,
      `Desyncs: ${desyncs}   Buf: ${bufDepth}`,
      `Estado: ${state}`,
    ];
    this.text.setText(lines.join('\n'));
    this.text.setY(GAME_HEIGHT - 42);
    this.exportBtn.setVisible(true);
    this.exportAllBtn.setVisible(true);
  }

  showToast(msg) {
    const toast = this.scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 50, msg, {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#ffffff',
      backgroundColor: '#333333cc',
      padding: { x: 6, y: 3 },
    });
    toast.setOrigin(0.5);
    toast.setDepth(201);
    toast.setScrollFactor(0);
    this.scene.tweens.add({
      targets: toast,
      alpha: 0,
      delay: 1500,
      duration: 500,
      onComplete: () => toast.destroy(),
    });
  }

  destroy() {
    if (this._timer) {
      this._timer.destroy();
      this._timer = null;
    }
    this.text?.destroy();
    this.exportBtn?.destroy();
    this.exportAllBtn?.destroy();
  }
}
