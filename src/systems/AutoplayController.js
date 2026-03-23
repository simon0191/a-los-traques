/**
 * AutoplayController — reads URL params to enable automated game play for E2E testing.
 *
 * URL params:
 *   ?autoplay=1        — enable autoplay mode
 *   ?fighter=simon     — pick specific fighter (default: random)
 *   ?createRoom=1      — create a new room (P1)
 *   ?room=XXXX         — join existing room (P2, already handled by BootScene)
 *   ?aiDifficulty=medium — AI difficulty (default: medium)
 *   ?seed=12345        — deterministic PRNG seed for reproducible AI decisions
 *   ?speed=10          — overclock: run N simulation steps per visual frame (default: 1)
 *   ?replay=1          — replay mode: replay a fight from window.__REPLAY_BUNDLE
 */
export class AutoplayController {
  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.enabled = params.get('autoplay') === '1' || params.get('replay') === '1';
    this.replay = params.get('replay') === '1';
    this.fighterId = params.get('fighter') || null;
    this.createRoom = params.get('createRoom') === '1';
    this.aiDifficulty = params.get('aiDifficulty') || 'medium';
    this.seed = params.has('seed') ? parseInt(params.get('seed'), 10) : null;
    this.speed = Math.max(1, parseInt(params.get('speed'), 10) || 1);
  }
}
